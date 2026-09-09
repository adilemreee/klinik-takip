import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikReportsFeature

private actor RecordingTransport: HTTPTransport {
    private let bodies: [String: (Int, String)]
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

private func report(
    id: String,
    risk: String?,
    generatedAt: String,
    patientFacing: String? = "Sade metin"
) -> String {
    let riskJSON = risk.map { "\"\($0)\"" } ?? "null"
    let facing = patientFacing.map { "\"\($0)\"" } ?? "null"

    return """
    {"report":{"id":"\(id)","patientId":"p1","source":"lab","contentMd":"Klinik metin",
      "patientFacingMd":\(facing),"riskLevel":\(riskJSON),"model":"claude","modelVersion":null,
      "generatedAt":"\(generatedAt)","reviewedById":null,"reviewedAt":null,
      "releasedToPatientAt":null},
     "patient":{"id":"p1","mrn":"2026-AAA","fullName":"Ayşe Yılmaz"},
     "disclaimer":"Yapay zeka üretti.","visibleToPatient":false}
    """
}

private func model(_ transport: RecordingTransport) async -> ReportReviewModel {
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

    return await ReportReviewModel(api: ReportsAPI(client: client))
}

final class ReportReviewModelTests: XCTestCase {
    /// A critical note from an hour ago outranks a low-risk one from yesterday.
    func testHighestRiskComesFirst() async {
        let transport = RecordingTransport(bodies: [
            "GET /reports/pending": (200, """
            [\(report(id: "low", risk: "LOW", generatedAt: "2026-09-08T09:00:00.000Z")),
             \(report(id: "critical", risk: "CRITICAL", generatedAt: "2026-09-09T08:00:00.000Z"))]
            """),
        ])

        let sut = await model(transport)
        await sut.load()

        let order = await sut.ordered().map(\.id)
        XCTAssertEqual(order, ["critical", "low"])
    }

    /// Within one risk level the oldest waits longest, so it goes first.
    func testOldestFirstWithinARiskLevel() async {
        let transport = RecordingTransport(bodies: [
            "GET /reports/pending": (200, """
            [\(report(id: "new", risk: "HIGH", generatedAt: "2026-09-09T08:00:00.000Z")),
             \(report(id: "old", risk: "HIGH", generatedAt: "2026-09-07T08:00:00.000Z"))]
            """),
        ])

        let sut = await model(transport)
        await sut.load()

        let order = await sut.ordered().map(\.id)
        XCTAssertEqual(order, ["old", "new"])
    }

    /**
     * A signed-off report leaves the queue.
     *
     * Without this the row stays and reads as unreviewed, and the obvious
     * remedy — reloading the whole list — would move everything under the
     * reader's thumb at the moment they are working through it.
     */
    func testReviewingRemovesTheReportFromTheQueue() async {
        let transport = RecordingTransport(bodies: [
            "GET /reports/pending": (200, """
            [\(report(id: "r1", risk: "HIGH", generatedAt: "2026-09-09T08:00:00.000Z"))]
            """),
            "PATCH /reports/r1/review": (200, report(
                id: "r1", risk: "HIGH", generatedAt: "2026-09-09T08:00:00.000Z"
            )),
        ])

        let sut = await model(transport)
        await sut.load()
        await sut.review("r1", release: true)

        let state = await sut.currentState()
        XCTAssertTrue(state.reports.isEmpty)
        XCTAssertEqual(state.phase, .empty)
        XCTAssertNil(state.actionError)
    }

    /// A failed review keeps the report in the queue and says why.
    func testAFailedReviewKeepsTheReport() async {
        let transport = RecordingTransport(bodies: [
            "GET /reports/pending": (200, """
            [\(report(id: "r1", risk: "HIGH", generatedAt: "2026-09-09T08:00:00.000Z"))]
            """),
            "PATCH /reports/r1/review": (403, #"{"statusCode":403,"message":"forbidden"}"#),
        ])

        let sut = await model(transport)
        await sut.load()
        await sut.review("r1", release: true)

        let state = await sut.currentState()
        XCTAssertEqual(state.reports.count, 1)
        XCTAssertNotNil(state.actionError)
    }

    /// Markdown headings and bullets survive; a broken string is shown as text.
    func testMarkdownFallsBackToThePlainString() {
        let mangled = "**unclosed"

        XCTAssertFalse(String(Markdown.attributed(mangled).characters).isEmpty)
    }
}
