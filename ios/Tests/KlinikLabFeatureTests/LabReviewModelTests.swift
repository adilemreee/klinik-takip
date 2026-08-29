import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikLabFeature

private actor RecordingTransport: HTTPTransport {
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

private struct FailingTransport: HTTPTransport {
    let error: APIError
    func send(_ request: URLRequest) async throws -> HTTPResponse { throw error }
}

private struct UnusedRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

/**
 * Reviewing what OCR read.
 *
 * Nothing on this screen is in the patient's record. The tests that matter are
 * the ones that keep it that way: a row leaves the queue only when a person
 * acted on it, and a failure to confirm must not look like a confirmation.
 */
final class LabReviewModelTests: XCTestCase {
    private func item(_ id: String, confidence: String, mapped: Bool) -> String {
        """
        {"result":{"id":"\(id)","analyteCode":\(mapped ? "\"718-7\"" : "null"),
          "analyteName":"Hemoglobin","value":"13.5","unit":"g/dL",
          "refLow":"12","refHigh":"16","flag":"NORMAL",
          "measuredAt":"2026-03-12T08:00:00.000Z","ocrConfidence":"\(confidence)",
          "verifiedAt":null},
         "needsAttention":\(Double(confidence)! < 0.8),"awaitingMapping":\(!mapped)}
        """
    }

    private func model(_ transport: HTTPTransport) async -> LabReviewModel {
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
        return LabReviewModel(api: LabAPI(client: client), patientId: "p1")
    }

    func testLoadsTheQueue() async {
        let review = await model(
            RecordingTransport(bodies: [
                "GET /patients/p1/lab-results/pending": (
                    200, "[\(item("r1", confidence: "0.42", mapped: false))]"
                ),
            ])
        )

        await review.load()

        let state = await review.currentState()

        XCTAssertEqual(state.phase, .loaded)
        XCTAssertEqual(state.items.map(\.id), ["r1"])
        XCTAssertTrue(state.items[0].needsAttention)
        XCTAssertTrue(state.items[0].awaitingMapping)
    }

    /// An empty queue is the good state, not a failure.
    func testReportsEmptySeparatelyFromFailure() async {
        let review = await model(
            RecordingTransport(bodies: ["GET /patients/p1/lab-results/pending": (200, "[]")])
        )

        await review.load()

        let phase = await review.currentState().phase
        XCTAssertEqual(phase, .empty)
    }

    func testCountsTheOnesNeedingAttention() async {
        let review = await model(
            RecordingTransport(bodies: [
                "GET /patients/p1/lab-results/pending": (
                    200,
                    "[\(item("r1", confidence: "0.42", mapped: true)),\(item("r2", confidence: "0.99", mapped: true))]"
                ),
            ])
        )

        await review.load()

        let count = await review.currentState().needingAttention
        XCTAssertEqual(count, 1)
    }

    /// Confirmed rows leave the list, so the reviewer can see what is left.
    func testRemovesAConfirmedRow() async {
        let review = await model(
            RecordingTransport(bodies: [
                "GET /patients/p1/lab-results/pending": (
                    200, "[\(item("r1", confidence: "0.9", mapped: true))]"
                ),
                "PATCH /lab-results/r1/verify": (
                    200,
                    """
                    {"id":"r1","analyteCode":"718-7","analyteName":"Hemoglobin","value":"13.5",
                     "unit":"g/dL","refLow":"12","refHigh":"16","flag":"NORMAL",
                     "measuredAt":"2026-03-12T08:00:00.000Z","ocrConfidence":"0.9",
                     "verifiedAt":"2026-03-12T09:00:00.000Z"}
                    """
                ),
            ])
        )

        await review.load()
        let confirmed = await review.confirm("r1")

        let state = await review.currentState()

        XCTAssertTrue(confirmed)
        XCTAssertTrue(state.items.isEmpty)
        XCTAssertEqual(state.phase, .empty)
    }

    /**
     * The dangerous case. A confirmation the server refused must leave the row
     * exactly where it was: dropping it would show the reviewer an empty queue
     * for a value that never reached the record.
     */
    func testKeepsTheRowWhenConfirmationFails() async {
        let review = await model(
            RecordingTransport(bodies: [
                "GET /patients/p1/lab-results/pending": (
                    200, "[\(item("r1", confidence: "0.9", mapped: true))]"
                ),
                "PATCH /lab-results/r1/verify": (
                    400, "{\"statusCode\":400,\"message\":\"Already verified\"}"
                ),
            ])
        )

        await review.load()
        let confirmed = await review.confirm("r1")

        let state = await review.currentState()

        XCTAssertFalse(confirmed)
        XCTAssertEqual(state.items.map(\.id), ["r1"])
        XCTAssertEqual(state.error, "Already verified")
    }

    func testRemovesADiscardedRow() async {
        let review = await model(
            RecordingTransport(bodies: [
                "GET /patients/p1/lab-results/pending": (
                    200, "[\(item("r1", confidence: "0.3", mapped: false))]"
                ),
                "DELETE /lab-results/r1": (204, ""),
            ])
        )

        await review.load()
        let discarded = await review.discard("r1")

        let state = await review.currentState()

        XCTAssertTrue(discarded)
        XCTAssertTrue(state.items.isEmpty)
    }

    /// A double tap must not send two confirmations for the same row.
    func testRefusesASecondActionWhileOneIsInFlight() async {
        let transport = RecordingTransport(bodies: [
            "GET /patients/p1/lab-results/pending": (
                200,
                "[\(item("r1", confidence: "0.9", mapped: true)),\(item("r2", confidence: "0.9", mapped: true))]"
            ),
            "PATCH /lab-results/r1/verify": (
                200,
                """
                {"id":"r1","analyteCode":"718-7","analyteName":"Hemoglobin","value":"13.5",
                 "unit":"g/dL","refLow":"12","refHigh":"16","flag":"NORMAL",
                 "measuredAt":"2026-03-12T08:00:00.000Z","ocrConfidence":"0.9",
                 "verifiedAt":"2026-03-12T09:00:00.000Z"}
                """
            ),
        ])
        let review = await model(transport)

        await review.load()

        async let first = review.confirm("r1")
        async let second = review.confirm("r1")

        let results = await [first, second]

        XCTAssertEqual(results.filter { $0 }.count, 1)
    }

    func testTreatsNotFoundAsItsOwnState() async {
        let review = await model(
            FailingTransport(error: .notFound(ErrorResponse(statusCode: 404, message: "")))
        )

        await review.load()

        let phase = await review.currentState().phase
        XCTAssertEqual(phase, .notFound)
    }
}
