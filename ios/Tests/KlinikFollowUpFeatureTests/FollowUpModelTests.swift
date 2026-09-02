import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikFollowUpFeature

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

private func milestone(
    _ id: String,
    label: String,
    dueAt: String,
    status: String = "PENDING"
) -> String {
    """
    {"id":"\(id)","label":"\(label)","dueAt":"\(dueAt)","status":"\(status)",
     "notifiedAt":null,"completedAt":null}
    """
}

private func schedule(_ milestones: [String]) -> String {
    """
    {"id":"s1","patientId":"p1","surgeryDate":"2026-03-02T09:00:00.000Z",
     "template":"default","milestones":[\(milestones.joined(separator: ","))]}
    """
}

/**
 * The check-up calendar.
 *
 * What a patient opens it for is one thing: when do I next have to come in.
 * Everything below is about that answer being right, and about a visit marked
 * attended actually being attended in the clinic's record too.
 */
final class FollowUpModelTests: XCTestCase {
    private func model(_ transport: HTTPTransport) async -> FollowUpModel {
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
        return FollowUpModel(api: FollowUpAPI(client: client))
    }

    func testLoadsTheSchedule() async {
        let followUp = await model(
            RecordingTransport(bodies: [
                "GET /me/follow-up": (
                    200,
                    schedule([
                        milestone("m1", label: "D1", dueAt: "2026-03-03T07:00:00.000Z"),
                        milestone("m2", label: "W1", dueAt: "2026-03-09T07:00:00.000Z"),
                    ])
                ),
            ])
        )

        await followUp.refresh()

        let state = await followUp.currentState()

        XCTAssertEqual(state.phase, .loaded)
        XCTAssertEqual(state.schedule?.milestones.map(\.label), ["D1", "W1"])
    }

    /**
     * No schedule is not a failure: usually the operation has not been recorded
     * yet, and showing an error would send the patient to the clinic about a
     * problem that is not one.
     */
    func testReportsNoScheduleSeparatelyFromFailure() async {
        let followUp = await model(RecordingTransport(bodies: ["GET /me/follow-up": (200, "{}")]))

        await followUp.refresh()

        let phase = await followUp.currentState().phase
        XCTAssertEqual(phase, .none)
    }

    /// The answer the screen exists to give.
    func testFindsTheNextVisitStillAhead() async {
        let past = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-86_400))
        let soon = ISO8601DateFormatter().string(from: Date().addingTimeInterval(86_400))
        let later = ISO8601DateFormatter().string(from: Date().addingTimeInterval(10 * 86_400))

        let followUp = await model(
            RecordingTransport(bodies: [
                "GET /me/follow-up": (
                    200,
                    schedule([
                        milestone("m1", label: "D1", dueAt: past, status: "COMPLETED"),
                        milestone("m2", label: "W1", dueAt: soon),
                        milestone("m3", label: "M1", dueAt: later),
                    ])
                ),
            ])
        )

        await followUp.refresh()

        let next = await followUp.currentState().next

        XCTAssertEqual(next?.id, "m2")
    }

    /// A visit already attended is not the next one to come to.
    func testSkipsCompletedVisitsWhenLookingAhead() async {
        let soon = ISO8601DateFormatter().string(from: Date().addingTimeInterval(86_400))
        let later = ISO8601DateFormatter().string(from: Date().addingTimeInterval(10 * 86_400))

        let followUp = await model(
            RecordingTransport(bodies: [
                "GET /me/follow-up": (
                    200,
                    schedule([
                        milestone("m1", label: "W1", dueAt: soon, status: "COMPLETED"),
                        milestone("m2", label: "M1", dueAt: later),
                    ])
                ),
            ])
        )

        await followUp.refresh()

        let next = await followUp.currentState().next
        XCTAssertEqual(next?.id, "m2")
    }

    func testCollectsMissedVisits() async {
        let past = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-10 * 86_400))

        let followUp = await model(
            RecordingTransport(bodies: [
                "GET /me/follow-up": (
                    200,
                    schedule([milestone("m1", label: "D1", dueAt: past, status: "MISSED")])
                ),
            ])
        )

        await followUp.refresh()

        let missed = await followUp.currentState().missed
        XCTAssertEqual(missed.map(\.id), ["m1"])
    }

    /**
     * A check-up that shows as attended when the clinic's record says otherwise
     * is the kind of disagreement nobody notices until someone is not called.
     */
    func testKeepsWhatTheServerReturnedWhenMarking() async {
        let due = ISO8601DateFormatter().string(from: Date().addingTimeInterval(86_400))

        let followUp = await model(
            RecordingTransport(bodies: [
                "GET /me/follow-up": (200, schedule([milestone("m1", label: "D1", dueAt: due)])),
                "PATCH /follow-up/milestones/m1": (
                    200,
                    """
                    {"id":"m1","label":"D1","dueAt":"\(due)","status":"COMPLETED",
                     "notifiedAt":null,"completedAt":"2026-03-03T09:00:00.000Z"}
                    """
                ),
            ])
        )

        await followUp.refresh()
        let marked = await followUp.mark("m1", as: .completed)

        let state = await followUp.currentState()

        XCTAssertTrue(marked)
        XCTAssertEqual(state.schedule?.milestones.first?.status, .completed)
        XCTAssertNil(state.next)
    }

    /// A refused mark must not leave the row looking attended.
    func testLeavesTheRowAloneWhenMarkingFails() async {
        let due = ISO8601DateFormatter().string(from: Date().addingTimeInterval(86_400))

        let followUp = await model(
            RecordingTransport(bodies: [
                "GET /me/follow-up": (200, schedule([milestone("m1", label: "D1", dueAt: due)])),
                "PATCH /follow-up/milestones/m1": (
                    400,
                    "{\"statusCode\":400,\"message\":\"A milestone can only be completed, skipped or missed\"}"
                ),
            ])
        )

        await followUp.refresh()
        let marked = await followUp.mark("m1", as: .completed)

        let state = await followUp.currentState()

        XCTAssertFalse(marked)
        XCTAssertEqual(state.schedule?.milestones.first?.status, .pending)
        XCTAssertEqual(
            state.error,
            "A milestone can only be completed, skipped or missed"
        )
    }

    /// A double tap must not send two marks for the same visit.
    func testRefusesASecondMarkWhileOneIsInFlight() async {
        let due = ISO8601DateFormatter().string(from: Date().addingTimeInterval(86_400))

        let transport = RecordingTransport(
            bodies: [
                "GET /me/follow-up": (200, schedule([milestone("m1", label: "D1", dueAt: due)])),
                "PATCH /follow-up/milestones/m1": (
                    200,
                    """
                    {"id":"m1","label":"D1","dueAt":"\(due)","status":"COMPLETED",
                     "notifiedAt":null,"completedAt":"2026-03-03T09:00:00.000Z"}
                    """
                ),
            ],
            delays: ["PATCH /follow-up/milestones/m1": .milliseconds(200)]
        )
        let followUp = await model(transport)

        await followUp.refresh()

        async let first = followUp.mark("m1", as: .completed)
        async let second = followUp.mark("m1", as: .skipped)

        let results = await [first, second]
        let calls = await transport.made()

        XCTAssertEqual(results.filter { $0 }.count, 1)
        XCTAssertEqual(calls.filter { $0.hasPrefix("PATCH") }.count, 1)
    }

    func testTreatsNotFoundAsItsOwnState() async {
        let followUp = await model(
            FailingTransport(error: .notFound(ErrorResponse(statusCode: 404, message: "")))
        )

        await followUp.refresh()

        let phase = await followUp.currentState().phase
        XCTAssertEqual(phase, .notFound)
    }
}
