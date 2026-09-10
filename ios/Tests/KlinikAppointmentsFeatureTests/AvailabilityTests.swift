import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikAppointmentsFeature

private actor ScriptedTransport: HTTPTransport {
    private var bodies: [String: (Int, String)]
    private(set) var calls: [String] = []

    init(bodies: [String: (Int, String)]) {
        self.bodies = bodies
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let key = "\(request.httpMethod ?? "GET") \(request.url!.path)"
        calls.append(key)

        guard let (status, body) = bodies[key] else {
            return HTTPResponse(status: 500, body: Data())
        }

        return HTTPResponse(status: status, body: Data(body.utf8))
    }

    func made() -> [String] { calls }
}

private struct UnusedRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

private func window(
    _ id: String,
    day: Int = 2,
    start: String = "09:00",
    end: String = "17:00",
    active: Bool = true
) -> String {
    """
    {"id":"\(id)","staffId":"s1","dayOfWeek":\(day),"startTime":"\(start)",\
    "endTime":"\(end)","timezone":"Europe/Istanbul","isActive":\(active)}
    """
}

/**
 * The hours a clinician is bookable in (spec M10).
 *
 * The state worth pinning is the empty one. The server refuses every booking
 * for a clinician who has published no hours — deliberately, because inventing
 * some would book patients into time nobody agreed to — so an empty list is
 * not "nothing configured yet", it is "no patient can book you", and the
 * screen has to say the second thing.
 */
final class AvailabilityTests: XCTestCase {
    private func model(_ transport: HTTPTransport) async -> AvailabilityModel {
        let session = SessionManager(store: InMemoryTokenStore(), refresher: UnusedRefresher())
        try? await session.signIn(
            with: SessionTokens(
                accessToken: "access",
                refreshToken: "refresh",
                expiresAt: Date().addingTimeInterval(900)
            )
        )
        let client = APIClient(
            configuration: APIConfiguration(baseURL: URL(string: "https://api.test")!),
            transport: transport,
            session: session
        )

        return AvailabilityModel(api: AppointmentsAPI(client: client))
    }

    func testNoHoursIsItsOwnState() async {
        let availability = await model(
            ScriptedTransport(bodies: ["GET /appointments/availability": (200, "[]")])
        )

        await availability.load()

        let state = await availability.currentState()
        XCTAssertEqual(state.phase, .empty)
    }

    func testPublishedHoursAreGroupedByDay() async {
        let availability = await model(
            ScriptedTransport(
                bodies: [
                    "GET /appointments/availability": (
                        200,
                        "[\(window("w1", day: 2)),\(window("w2", day: 4)),\(window("w3", day: 2, start: "18:00", end: "20:00"))]"
                    )
                ]
            )
        )

        await availability.load()

        let state = await availability.currentState()
        XCTAssertEqual(state.phase, .loaded)
        XCTAssertEqual(state.byDay.map(\.day), [2, 4])
        XCTAssertEqual(state.byDay.first?.windows.count, 2)
    }

    /// No staff profile is a wiring problem, not an empty week — and the two
    /// need different words on screen.
    func testNoStaffProfileIsNotAnEmptyWeek() async {
        let availability = await model(
            ScriptedTransport(
                bodies: [
                    "GET /appointments/availability": (
                        404, #"{"statusCode":404,"message":"This account has no staff profile"}"#
                    )
                ]
            )
        )

        await availability.load()

        let state = await availability.currentState()
        XCTAssertEqual(state.phase, .notFound)
    }

    /// The server knows a window ends before it starts; showing our own words
    /// instead would say less.
    func testARefusedWindowKeepsTheServersMessage() async {
        let availability = await model(
            ScriptedTransport(
                bodies: [
                    "GET /appointments/availability": (200, "[]"),
                    "POST /appointments/availability": (
                        400, #"{"statusCode":400,"message":"endTime must be after startTime"}"#
                    ),
                ]
            )
        )

        let published = await availability.publish(dayOfWeek: 2, startTime: "17:00", endTime: "09:00")

        XCTAssertFalse(published)

        let state = await availability.currentState()
        XCTAssertEqual(state.error, "endTime must be after startTime")
    }

    /// A week away is not a change to the working week. Making somebody
    /// re-enter their hours afterwards is how they stop bothering.
    func testPausingKeepsTheWindow() async {
        let transport = ScriptedTransport(
            bodies: [
                "GET /appointments/availability": (200, "[\(window("w1", active: false))]"),
                "PATCH /appointments/availability/w1": (200, window("w1", active: false)),
            ]
        )
        let availability = await model(transport)
        await availability.load()

        let changed = await availability.setActive(
            AvailabilityWindow(id: "w1", staffId: "s1", dayOfWeek: 2, startTime: "09:00", endTime: "17:00"),
            isActive: false
        )

        XCTAssertTrue(changed)

        let calls = await transport.made()
        XCTAssertTrue(calls.contains("PATCH /appointments/availability/w1"))
        XCTAssertFalse(
            calls.contains("DELETE /appointments/availability/w1"),
            "Pausing must not delete the window"
        )
    }

    // MARK: - The sheet's own arithmetic

    func testTimeIsFormattedAsTheServerExpects() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Istanbul")!

        let nine = calendar.date(from: DateComponents(year: 2026, month: 3, day: 2, hour: 9, minute: 5))!

        XCTAssertEqual(AddWindowSheet.text(from: nine, calendar: calendar), "09:05")
    }

    func testAWindowEndingBeforeItStartsIsRefusedBeforeTheRoundTrip() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Istanbul")!

        let nine = calendar.date(from: DateComponents(year: 2026, month: 3, day: 2, hour: 9))!
        let five = calendar.date(from: DateComponents(year: 2026, month: 3, day: 2, hour: 17))!

        XCTAssertTrue(AddWindowSheet.isOrdered(nine, five, calendar: calendar))
        XCTAssertFalse(AddWindowSheet.isOrdered(five, nine, calendar: calendar))
        XCTAssertFalse(AddWindowSheet.isOrdered(nine, nine, calendar: calendar), "Zero length is not a window")
    }

    func testSundayIsDayZeroLikeTheServer() {
        let calendar = Calendar(identifier: .gregorian)

        XCTAssertEqual(AvailabilityScreen.dayName(0), calendar.weekdaySymbols[0].capitalized)
        XCTAssertEqual(AvailabilityScreen.dayName(6), calendar.weekdaySymbols[6].capitalized)
    }
}
