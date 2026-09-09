import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikSurveysFeature

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

private func model(_ transport: RecordingTransport) async -> SurveyModel {
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

    return await SurveyModel(api: SurveysAPI(client: client))
}

/// One survey with a required pain score and an optional note.
private let pending = """
[{"id":"a1","title":"Nasılsınız?","description":null,"milestoneDays":7,
  "scheduledFor":"2026-09-01T08:00:00.000Z","expiresAt":"2099-01-01T00:00:00.000Z",
  "questions":[
    {"id":"pain","text":"Ağrınız","type":"SCALE_0_10","direction":"higher-is-worse",
     "alarmAt":7,"required":true},
    {"id":"note","text":"Eklemek istediğiniz","type":"TEXT","direction":null,
     "alarmAt":null,"required":false}]}]
"""

final class SurveyModelTests: XCTestCase {
    /**
     * A required question with no answer blocks the send.
     *
     * The whole form goes at once precisely so half-answered surveys do not
     * reach the record — an unanswered pain score is not a pain score of
     * nothing, and a clinician reading one as the other would be reading a
     * patient's silence as a report.
     */
    func testAnUnansweredRequiredQuestionBlocksSubmission() async {
        let sut = await model(RecordingTransport(bodies: ["GET /me/surveys": (200, pending)]))
        await sut.load()

        var canSubmit = await sut.currentState().canSubmit
        XCTAssertFalse(canSubmit)

        await sut.answer("note", .text("iyiyim"))
        canSubmit = await sut.currentState().canSubmit
        XCTAssertFalse(canSubmit, "an optional answer must not unlock the form")

        await sut.answer("pain", .scale(3))
        canSubmit = await sut.currentState().canSubmit
        XCTAssertTrue(canSubmit)
    }

    /// Nothing is sent while the form is incomplete.
    func testSubmitDoesNothingWhileIncomplete() async {
        let transport = RecordingTransport(bodies: ["GET /me/surveys": (200, pending)])
        let sut = await model(transport)

        await sut.load()
        await sut.submit()

        let calls = await transport.made()
        XCTAssertEqual(calls, ["GET /me/surveys"])
    }

    func testASubmittedSurveyLeavesTheList() async {
        let transport = RecordingTransport(bodies: [
            "GET /me/surveys": (200, pending),
            "POST /me/surveys/a1": (200, #"{"assignmentId":"a1","invited":false}"#),
        ])
        let sut = await model(transport)

        await sut.load()
        await sut.answer("pain", .scale(2))
        await sut.submit()

        let state = await sut.currentState()
        XCTAssertTrue(state.surveys.isEmpty)
        XCTAssertTrue(state.submitted)
        XCTAssertEqual(state.phase, SurveyPhase.none)
        XCTAssertNil(state.error)
    }

    /// A failed send keeps the answers, so nobody retypes eight of them.
    func testAFailedSubmissionKeepsTheAnswers() async {
        let transport = RecordingTransport(bodies: [
            "GET /me/surveys": (200, pending),
            "POST /me/surveys/a1": (500, "{}"),
        ])
        let sut = await model(transport)

        await sut.load()
        await sut.answer("pain", .scale(9))
        await sut.submit()

        let state = await sut.currentState()
        XCTAssertEqual(state.answers["pain"], .scale(9))
        XCTAssertEqual(state.surveys.count, 1)
        XCTAssertNotNil(state.error)
    }
}
