import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikLabFeature

private actor TrendTransport: HTTPTransport {
    private let bodies: [String: (Int, String)]
    private(set) var calls: [String] = []

    init(bodies: [String: (Int, String)]) {
        self.bodies = bodies
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path
        calls.append(path)

        guard let (status, body) = bodies[path] else {
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

final class LabTrendModelTests: XCTestCase {
    private func trend(
        name: String,
        unit: String = "g/dL",
        code: String = "718-7",
        reference: String = "{\"low\":12,\"high\":16}",
        latestFlag: String = "\"NORMAL\""
    ) -> String {
        """
        {"analyteCode":"\(code)","analyteName":"\(name)","unit":"\(unit)",
         "points":[
           {"measuredAt":"2026-01-02T08:00:00.000Z","value":13.5,"flag":"NORMAL","refLow":12,"refHigh":16},
           {"measuredAt":"2026-02-02T08:00:00.000Z","value":14.1,"flag":"NORMAL","refLow":12,"refHigh":16}
         ],
         "reference":\(reference),"latestFlag":\(latestFlag)}
        """
    }

    private let criticalResult = """
    [{"id":"r9","analyteCode":"718-7","analyteName":"Hemoglobin","value":"4",
      "unit":"g/dL","refLow":"12","refHigh":"16","flag":"CRITICAL",
      "measuredAt":"2026-03-01T08:00:00.000Z","ocrConfidence":"0.9",
      "verifiedAt":"2026-03-01T09:00:00.000Z"}]
    """

    private func model(_ transport: HTTPTransport) async -> LabTrendModel {
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
        return LabTrendModel(api: LabAPI(client: client), subject: .patient(id: "p1"))
    }

    func testLoadsTrendsAndSelectsTheFirst() async {
        let model = await model(
            TrendTransport(bodies: [
                "/patients/p1/lab-results/trends": (200, "[\(trend(name: "Hemoglobin"))]"),
                "/patients/p1/lab-results/critical": (200, "[]"),
            ])
        )

        await model.load()

        let state = await model.currentState()

        XCTAssertEqual(state.phase, .loaded)
        XCTAssertEqual(state.trends.count, 1)
        XCTAssertEqual(state.selectedTrend?.analyteName, "Hemoglobin")
        XCTAssertEqual(state.selectedTrend?.points.count, 2)
    }

    func testCarriesTheReferenceBand() async {
        let model = await model(
            TrendTransport(bodies: [
                "/patients/p1/lab-results/trends": (200, "[\(trend(name: "Hemoglobin"))]"),
                "/patients/p1/lab-results/critical": (200, "[]"),
            ])
        )

        await model.load()

        let band = await model.currentState().selectedTrend?.reference

        XCTAssertEqual(band?.low, 12)
        XCTAssertEqual(band?.high, 16)
    }

    /**
     * No band is a real answer, not a missing field: the points were measured
     * against different ranges, and one band across them would put results on
     * the wrong side of a line they were never compared to.
     */
    func testAcceptsATrendWithNoBand() async {
        let model = await model(
            TrendTransport(bodies: [
                "/patients/p1/lab-results/trends": (
                    200, "[\(trend(name: "Hemoglobin", reference: "null"))]"
                ),
                "/patients/p1/lab-results/critical": (200, "[]"),
            ])
        )

        await model.load()

        let state = await model.currentState()

        XCTAssertEqual(state.phase, .loaded)
        XCTAssertNil(state.selectedTrend?.reference)
        // The per-point ranges survive, so the screen can still say something.
        XCTAssertEqual(state.selectedTrend?.points.first?.refLow, 12)
    }

    /// The same analyte in two units is two series, never one axis.
    func testKeepsTwoUnitsApart() async {
        let model = await model(
            TrendTransport(bodies: [
                "/patients/p1/lab-results/trends": (
                    200,
                    "[\(trend(name: "Glukoz", unit: "mg/dL")),\(trend(name: "Glukoz", unit: "mmol/L"))]"
                ),
                "/patients/p1/lab-results/critical": (200, "[]"),
            ])
        )

        await model.load()

        let state = await model.currentState()

        XCTAssertEqual(state.trends.count, 2)
        XCTAssertNotEqual(state.trends[0].id, state.trends[1].id)
    }

    /// A critical value must not depend on which chart the doctor opened.
    func testLoadsCriticalValuesAlongsideTheCharts() async {
        let model = await model(
            TrendTransport(bodies: [
                "/patients/p1/lab-results/trends": (200, "[\(trend(name: "Hemoglobin"))]"),
                "/patients/p1/lab-results/critical": (200, criticalResult),
            ])
        )

        await model.load()

        let state = await model.currentState()

        XCTAssertEqual(state.critical.count, 1)
        XCTAssertEqual(state.critical[0].flag, .critical)
    }

    /// Nothing confirmed yet is not a failure — results exist only after review.
    func testReportsEmptySeparatelyFromFailure() async {
        let model = await model(
            TrendTransport(bodies: [
                "/patients/p1/lab-results/trends": (200, "[]"),
                "/patients/p1/lab-results/critical": (200, "[]"),
            ])
        )

        await model.load()

        let phase = await model.currentState().phase
        XCTAssertEqual(phase, .empty)
    }

    func testTreatsNotFoundAsItsOwnState() async {
        let model = await model(
            FailingTransport(error: .notFound(ErrorResponse(statusCode: 404, message: "")))
        )

        await model.load()

        let phase = await model.currentState().phase
        XCTAssertEqual(phase, .notFound)
    }

    func testSwitchesTheSelectedAnalyte() async {
        let model = await model(
            TrendTransport(bodies: [
                "/patients/p1/lab-results/trends": (
                    200,
                    "[\(trend(name: "Glukoz", unit: "mg/dL", code: "2345-7")),\(trend(name: "Kreatinin", unit: "mg/dL", code: "2160-0"))]"
                ),
                "/patients/p1/lab-results/critical": (200, "[]"),
            ])
        )

        await model.load()
        let second = await model.currentState().trends[1].id
        await model.select(second)

        let selected = await model.currentState().selectedTrend?.analyteName
        XCTAssertEqual(selected, "Kreatinin")
    }
}
