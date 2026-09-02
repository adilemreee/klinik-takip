import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikAppointmentsFeature

private actor RecordingTransport: HTTPTransport {
    private var bodies: [String: (Int, String)]
    private let delays: [String: Duration]
    private(set) var calls: [String] = []

    init(bodies: [String: (Int, String)], delays: [String: Duration] = [:]) {
        self.bodies = bodies
        self.delays = delays
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let key = "\(request.httpMethod ?? "GET") \(request.url!.path)"
        calls.append(key)

        if let delay = delays[key] {
            try? await Task.sleep(for: delay)
        }

        guard let (status, body) = bodies[key] else {
            return HTTPResponse(status: 500, body: Data())
        }

        return HTTPResponse(status: status, body: Data(body.utf8))
    }

    func made() -> [String] { calls }
}

private struct FailingTransport: HTTPTransport {
    let error: APIError
    func send(_ request: URLRequest) async throws -> HTTPResponse { throw error }
}

private struct UnusedRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

private func appointment(
    _ id: String,
    at scheduledAt: String,
    status: String = "CONFIRMED",
    type: String = "CONTROL"
) -> String {
    """
    {"id":"\(id)","patientId":"p1","staffId":"s1","type":"\(type)","status":"\(status)",
     "scheduledAt":"\(scheduledAt)","durationMinutes":30,"location":null,"note":null,
     "cancelledAt":null,"cancelledReason":null,"remindersSent":[]}
    """
}

/**
 * Appointments.
 *
 * A patient opens this for one answer — when do I come in — and a refused
 * booking has to say which kind of refusal it was, because "taken" and "the
 * clinic is shut" send them looking in different places.
 */
final class AppointmentsModelTests: XCTestCase {
    private func model(_ transport: HTTPTransport) async -> AppointmentsModel {
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
        return AppointmentsModel(api: AppointmentsAPI(client: client))
    }

    private func iso(_ offset: TimeInterval) -> String {
        ISO8601DateFormatter().string(from: Date().addingTimeInterval(offset))
    }

    func testLoadsAppointments() async {
        let appointments = await model(
            RecordingTransport(bodies: [
                "GET /me/appointments": (200, "[\(appointment("a1", at: iso(86_400)))]"),
            ])
        )

        await appointments.refresh()

        let state = await appointments.currentState()

        XCTAssertEqual(state.phase, .loaded)
        XCTAssertEqual(state.appointments.map(\.id), ["a1"])
    }

    /// Nothing booked is not a failure.
    func testReportsEmptySeparatelyFromFailure() async {
        let appointments = await model(
            RecordingTransport(bodies: ["GET /me/appointments": (200, "[]")])
        )

        await appointments.refresh()

        let phase = await appointments.currentState().phase
        XCTAssertEqual(phase, .empty)
    }

    /// The one answer the screen exists to give.
    func testFindsTheNextAppointmentStillAhead() async {
        let appointments = await model(
            RecordingTransport(bodies: [
                "GET /me/appointments": (
                    200,
                    "[\(appointment("past", at: iso(-86_400))),\(appointment("soon", at: iso(3_600))),\(appointment("later", at: iso(864_000)))]"
                ),
            ])
        )

        await appointments.refresh()

        let next = await appointments.currentState().next()
        XCTAssertEqual(next?.id, "soon")
    }

    /// A cancelled appointment is not the next one to come to.
    func testSkipsCancelledWhenLookingAhead() async {
        let appointments = await model(
            RecordingTransport(bodies: [
                "GET /me/appointments": (
                    200,
                    "[\(appointment("cancelled", at: iso(3_600), status: "CANCELLED")),\(appointment("real", at: iso(7_200)))]"
                ),
            ])
        )

        await appointments.refresh()

        let next = await appointments.currentState().next()
        XCTAssertEqual(next?.id, "real")
    }

    func testCollectsRequestsAwaitingConfirmation() async {
        let appointments = await model(
            RecordingTransport(bodies: [
                "GET /me/appointments": (
                    200,
                    "[\(appointment("r1", at: iso(3_600), status: "REQUESTED")),\(appointment("c1", at: iso(7_200)))]"
                ),
            ])
        )

        await appointments.refresh()

        let waiting = await appointments.currentState().awaitingConfirmation
        XCTAssertEqual(waiting.map(\.id), ["r1"])
    }

    /**
     * "Taken" sends someone looking for another slot; "the clinic is shut"
     * sends them to another day. Saying the wrong one wastes their afternoon.
     */
    func testExplainsATakenSlotAndAClosedClinicDifferently() async {
        let taken = await model(
            RecordingTransport(bodies: [
                "GET /me/appointments": (200, "[]"),
                "POST /me/appointments": (
                    409, "{\"statusCode\":409,\"message\":\"SLOT_TAKEN\"}"
                ),
            ])
        )

        await taken.refresh()
        let bookedTaken = await taken.request(type: .control, at: Date(), staffId: "s1")
        let takenMessage = await taken.currentState().error

        let closed = await model(
            RecordingTransport(bodies: [
                "GET /me/appointments": (200, "[]"),
                "POST /me/appointments": (
                    409, "{\"statusCode\":409,\"message\":\"OUTSIDE_AVAILABILITY\"}"
                ),
            ])
        )

        await closed.refresh()
        _ = await closed.request(type: .control, at: Date(), staffId: "s1")
        let closedMessage = await closed.currentState().error

        XCTAssertFalse(bookedTaken)
        XCTAssertNotNil(takenMessage)
        XCTAssertNotNil(closedMessage)
        XCTAssertNotEqual(takenMessage, closedMessage)
    }

    /**
     * A patient who cancelled should see that it is cancelled rather than watch
     * it vanish and wonder whether the clinic got the message.
     */
    func testKeepsACancelledAppointmentOnScreen() async {
        let at = iso(86_400)

        let appointments = await model(
            RecordingTransport(bodies: [
                "GET /me/appointments": (200, "[\(appointment("a1", at: at))]"),
                "PATCH /appointments/a1/cancel": (
                    200,
                    """
                    {"id":"a1","patientId":"p1","staffId":"s1","type":"CONTROL",
                     "status":"CANCELLED","scheduledAt":"\(at)","durationMinutes":30,
                     "location":null,"note":null,"cancelledAt":"\(at)",
                     "cancelledReason":null,"remindersSent":[]}
                    """
                ),
            ])
        )

        await appointments.refresh()
        let cancelled = await appointments.cancel("a1")

        let state = await appointments.currentState()

        XCTAssertTrue(cancelled)
        XCTAssertEqual(state.appointments.count, 1)
        XCTAssertEqual(state.appointments.first?.status, .cancelled)
        XCTAssertNil(state.next())
    }

    func testConfirmsARequest() async {
        let at = iso(86_400)

        let appointments = await model(
            RecordingTransport(bodies: [
                "GET /me/appointments": (
                    200, "[\(appointment("a1", at: at, status: "REQUESTED"))]"
                ),
                "PATCH /appointments/a1/confirm": (200, appointment("a1", at: at)),
            ])
        )

        await appointments.refresh()
        let confirmed = await appointments.confirm("a1")

        let state = await appointments.currentState()

        XCTAssertTrue(confirmed)
        XCTAssertEqual(state.appointments.first?.status, .confirmed)
        XCTAssertTrue(state.awaitingConfirmation.isEmpty)
    }

    /// A refused action must not leave the row looking as though it worked.
    func testLeavesTheRowAloneWhenAnActionFails() async {
        let at = iso(86_400)

        let appointments = await model(
            RecordingTransport(bodies: [
                "GET /me/appointments": (
                    200, "[\(appointment("a1", at: at, status: "REQUESTED"))]"
                ),
                "PATCH /appointments/a1/confirm": (
                    400,
                    "{\"statusCode\":400,\"message\":\"This appointment is already confirmed\"}"
                ),
            ])
        )

        await appointments.refresh()
        let confirmed = await appointments.confirm("a1")

        let state = await appointments.currentState()

        XCTAssertFalse(confirmed)
        XCTAssertEqual(state.appointments.first?.status, .requested)
        XCTAssertEqual(state.error, "This appointment is already confirmed")
    }

    /// A double tap must not send two requests for the same slot.
    func testRefusesASecondRequestWhileOneIsInFlight() async {
        let at = iso(86_400)

        let transport = RecordingTransport(
            bodies: [
                "GET /me/appointments": (200, "[]"),
                "POST /me/appointments": (201, appointment("a1", at: at, status: "REQUESTED")),
            ],
            delays: ["POST /me/appointments": .milliseconds(200)]
        )
        let appointments = await model(transport)

        await appointments.refresh()

        async let first = appointments.request(type: .control, at: Date(), staffId: "s1")
        async let second = appointments.request(type: .control, at: Date(), staffId: "s1")

        let results = await [first, second]
        let calls = await transport.made()

        XCTAssertEqual(results.filter { $0 }.count, 1)
        XCTAssertEqual(calls.filter { $0 == "POST /me/appointments" }.count, 1)
    }

    func testTreatsNotFoundAsItsOwnState() async {
        let appointments = await model(
            FailingTransport(error: .notFound(ErrorResponse(statusCode: 404, message: "")))
        )

        await appointments.refresh()

        let phase = await appointments.currentState().phase
        XCTAssertEqual(phase, .notFound)
    }
}
