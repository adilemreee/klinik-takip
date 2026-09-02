import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikComplicationsFeature

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

private func view(
    id: String,
    status: String = "REPORTED",
    waiting: Int = 30,
    response: String = "null",
    overdue: Bool = false,
    acknowledgedAt: String = "null"
) -> String {
    """
    {"complication":{"id":"\(id)","patientId":"p1","status":"\(status)",
      "note":"Yara kızardı","bodyArea":"abdomen",
      "reportedAt":"2026-03-01T08:00:00.000Z","acknowledgedAt":\(acknowledgedAt),
      "firstResponse":\(response),"resolvedAt":null,"resolution":null},
     "photos":[],"waitingMinutes":\(waiting),
     "responseMinutes":\(acknowledgedAt == "null" ? "null" : String(waiting)),
     "overdue":\(overdue)}
    """
}

private func client(_ transport: HTTPTransport) async -> APIClient {
    let session = SessionManager(store: InMemoryTokenStore(), refresher: UnusedRefresher())
    try? await session.signIn(
        with: SessionTokens(
            accessToken: "access",
            refreshToken: "refresh",
            expiresAt: Date().addingTimeInterval(900)
        )
    )
    return APIClient(
        configuration: APIConfiguration(baseURL: URL(string: "https://api.test")!),
        transport: transport,
        session: session
    )
}

/**
 * A report reaching a clinician, and how long it waited.
 *
 * The response time is the only number this feature exists to produce, so the
 * tests are mostly about it staying true — and about a failed reply never
 * looking like a successful one.
 */
final class ComplicationQueueModelTests: XCTestCase {
    private func model(_ transport: HTTPTransport) async -> ComplicationQueueModel {
        ComplicationQueueModel(api: ComplicationsAPI(client: await client(transport)))
    }

    func testLoadsTheQueue() async {
        let queue = await model(
            RecordingTransport(bodies: [
                "GET /complications": (200, "[\(view(id: "c1", waiting: 200, overdue: true))]"),
            ])
        )

        await queue.load()

        let state = await queue.currentState()

        XCTAssertEqual(state.phase, .loaded)
        XCTAssertEqual(state.items.map(\.id), ["c1"])
        XCTAssertEqual(state.items[0].waitingMinutes, 200)
        XCTAssertTrue(state.items[0].overdue)
    }

    /// The number that makes someone open this screen.
    func testCountsWhatHasWaitedTooLong() async {
        let queue = await model(
            RecordingTransport(bodies: [
                "GET /complications": (
                    200,
                    "[\(view(id: "c1", waiting: 200, overdue: true)),\(view(id: "c2", waiting: 5))]"
                ),
            ])
        )

        await queue.load()

        let count = await queue.currentState().overdueCount
        XCTAssertEqual(count, 1)
    }

    /// An empty queue is the good state, not a failure.
    func testReportsEmptySeparatelyFromFailure() async {
        let queue = await model(RecordingTransport(bodies: ["GET /complications": (200, "[]")]))

        await queue.load()

        let phase = await queue.currentState().phase
        XCTAssertEqual(phase, .empty)
    }

    /**
     * The answered report stays on screen. Taking it away the moment the
     * clinician replied would make them go looking for it again to close it.
     */
    func testKeepsAnAnsweredReportInTheList() async {
        let queue = await model(
            RecordingTransport(bodies: [
                "GET /complications": (200, "[\(view(id: "c1"))]"),
                "PATCH /complications/c1/acknowledge": (
                    200,
                    view(
                        id: "c1",
                        status: "ACKNOWLEDGED",
                        response: "\"Yarın kontrole gelin\"",
                        acknowledgedAt: "\"2026-03-01T08:30:00.000Z\""
                    )
                ),
            ])
        )

        await queue.load()
        let answered = await queue.acknowledge("c1", message: "Yarın kontrole gelin")

        let state = await queue.currentState()

        XCTAssertTrue(answered)
        XCTAssertEqual(state.items.count, 1)
        XCTAssertEqual(state.items[0].complication.status, .acknowledged)
        XCTAssertEqual(state.items[0].complication.firstResponse, "Yarın kontrole gelin")
        XCTAssertEqual(state.items[0].responseMinutes, 30)
    }

    /// A reply the server refused must not look like one it accepted.
    func testKeepsTheRowUnchangedWhenAnsweringFails() async {
        let queue = await model(
            RecordingTransport(bodies: [
                "GET /complications": (200, "[\(view(id: "c1"))]"),
                "PATCH /complications/c1/acknowledge": (
                    400, "{\"statusCode\":400,\"message\":\"This report has already been answered\"}"
                ),
            ])
        )

        await queue.load()
        let answered = await queue.acknowledge("c1", message: "Görüldü")

        let state = await queue.currentState()

        XCTAssertFalse(answered)
        XCTAssertEqual(state.items[0].complication.status, .reported)
        XCTAssertEqual(state.error, "This report has already been answered")
    }

    /// A double tap must not send two replies for the same report.
    func testRefusesASecondActionWhileOneIsInFlight() async {
        let transport = RecordingTransport(
            bodies: [
                "GET /complications": (200, "[\(view(id: "c1"))]"),
                "PATCH /complications/c1/acknowledge": (
                    200, view(id: "c1", status: "ACKNOWLEDGED", acknowledgedAt: "\"2026-03-01T08:30:00.000Z\"")
                ),
            ],
            delays: ["PATCH /complications/c1/acknowledge": .milliseconds(200)]
        )
        let queue = await model(transport)

        await queue.load()

        async let first = queue.acknowledge("c1", message: "Görüldü")
        async let second = queue.acknowledge("c1", message: "Görüldü")

        let results = await [first, second]

        XCTAssertEqual(results.filter { $0 }.count, 1)
    }

    func testResolvesAReport() async {
        let queue = await model(
            RecordingTransport(bodies: [
                "GET /complications": (200, "[\(view(id: "c1"))]"),
                "PATCH /complications/c1/resolve": (
                    200, view(id: "c1", status: "RESOLVED", acknowledgedAt: "\"2026-03-01T08:30:00.000Z\"")
                ),
            ])
        )

        await queue.load()
        let resolved = await queue.resolve("c1", message: "Düzeldi")

        let state = await queue.currentState()

        XCTAssertTrue(resolved)
        XCTAssertEqual(state.items[0].complication.status, .resolved)
    }
}

final class MyComplicationsModelTests: XCTestCase {
    private func model(_ transport: HTTPTransport) async -> MyComplicationsModel {
        MyComplicationsModel(api: ComplicationsAPI(client: await client(transport)))
    }

    /**
     * A patient who cannot see an answer reports the same worry again. The
     * reply is the point of this screen.
     */
    func testShowsTheClinicReply() async {
        let mine = await model(
            RecordingTransport(bodies: [
                "GET /me/complications": (
                    200,
                    "[\(view(id: "c1", status: "ACKNOWLEDGED", response: "\"Yarın kontrole gelin\"", acknowledgedAt: "\"2026-03-01T08:30:00.000Z\""))]"
                ),
            ])
        )

        await mine.load()

        let items = await mine.currentState().items

        XCTAssertEqual(items[0].complication.firstResponse, "Yarın kontrole gelin")
    }

    func testReportsAndReloads() async {
        let transport = RecordingTransport(bodies: [
            "POST /me/complications": (201, view(id: "c1")),
            "GET /me/complications": (200, "[\(view(id: "c1"))]"),
        ])
        let mine = await model(transport)

        let sent = await mine.report(note: "Yara kızardı", bodyArea: "abdomen")
        let calls = await transport.made()

        XCTAssertTrue(sent)
        // Reloaded from the server rather than assuming what was stored.
        XCTAssertEqual(calls, ["POST /me/complications", "GET /me/complications"])
    }

    /// The server refuses a report with no description and says so.
    func testKeepsTheServerMessageWhenAReportIsRefused() async {
        let mine = await model(
            FailingTransport(
                error: .validation(
                    ErrorResponse(statusCode: 400, message: "Describe what is wrong")
                )
            )
        )

        let sent = await mine.report(note: "   ", bodyArea: nil)
        let error = await mine.currentState().error

        XCTAssertFalse(sent)
        XCTAssertEqual(error, "Describe what is wrong")
    }

    /// A double tap must not file the same report twice.
    func testRefusesASecondReportWhileOneIsInFlight() async {
        let transport = RecordingTransport(
            bodies: [
                "POST /me/complications": (201, view(id: "c1")),
                "GET /me/complications": (200, "[\(view(id: "c1"))]"),
            ],
            delays: ["POST /me/complications": .milliseconds(200)]
        )
        let mine = await model(transport)

        async let first = mine.report(note: "Yara kızardı", bodyArea: nil)
        async let second = mine.report(note: "Yara kızardı", bodyArea: nil)

        let results = await [first, second]
        let calls = await transport.made()

        XCTAssertEqual(results.filter { $0 }.count, 1)
        XCTAssertEqual(calls.filter { $0 == "POST /me/complications" }.count, 1)
    }

    func testReportsNotFoundWhenTheAccountHasNoFile() async {
        let mine = await model(
            FailingTransport(error: .notFound(ErrorResponse(statusCode: 404, message: "")))
        )

        await mine.load()

        let phase = await mine.currentState().phase
        XCTAssertEqual(phase, .notFound)
    }
}
