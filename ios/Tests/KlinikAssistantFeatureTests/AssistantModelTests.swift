import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikAssistantFeature

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

private func model(_ transport: RecordingTransport) async -> AssistantModel {
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

    return await AssistantModel(api: AssistantAPI(client: client))
}

final class AssistantModelTests: XCTestCase {
    /// An answer must always carry the way out to a person (spec M4).
    func testAnAnsweredQuestionCanStillGoToADoctor() async {
        let transport = RecordingTransport(bodies: [
            "POST /me/assistant/ask": (200, """
            {"questionMessageId":"m1","answered":true,"answer":"Duş için 48 saat bekleyin.",
             "sources":["Taburculuk talimatı"],"handoverReason":null}
            """),
        ])

        let sut = await model(transport)
        await sut.ask("Ne zaman duş alabilirim?")

        let turn = await sut.currentState().turns.first
        XCTAssertEqual(turn?.canEscalate, true)
        XCTAssertEqual(turn?.isAnswered, true)
    }

    /**
     * A handover is not offered again.
     *
     * The server has already put the question in front of a person. A second
     * "send this to a doctor" button would send it twice, and the clinic would
     * see two copies of one worry.
     */
    func testAHandoverIsNotOfferedForEscalationAgain() async {
        let transport = RecordingTransport(bodies: [
            "POST /me/assistant/ask": (200, """
            {"questionMessageId":"m2","answered":false,"answer":null,
             "sources":[],"handoverReason":"no-sources"}
            """),
        ])

        let sut = await model(transport)
        await sut.ask("Dikişim kanıyor")

        let turn = await sut.currentState().turns.first
        XCTAssertEqual(turn?.canEscalate, false)
        XCTAssertEqual(turn?.escalated, true)
        // The patient is told a person will read it, not why the bot declined.
        XCTAssertEqual(turn?.result?.displayText, L10n.string("assistant.handover"))
    }

    /**
     * A question that never reached the server is not a handover.
     *
     * Telling somebody "a person will answer this" when nothing was sent is a
     * lie the screen would be telling on the assistant's behalf.
     */
    func testAFailedAskIsNotShownAsAHandover() async {
        let sut = await model(RecordingTransport(bodies: [:]))
        await sut.ask("Ateşim var")

        let turn = await sut.currentState().turns.first
        XCTAssertNotNil(turn?.failure)
        XCTAssertNil(turn?.result)
        XCTAssertEqual(turn?.escalated, false)
    }

    /// The question appears before the answer does, so the wait is legible.
    func testTheQuestionIsShownWhileTheAnswerIsAwaited() async {
        let transport = RecordingTransport(bodies: [
            "POST /me/assistant/ask": (200, """
            {"questionMessageId":"m3","answered":true,"answer":"Evet.",
             "sources":[],"handoverReason":null}
            """),
        ])

        let sut = await model(transport)
        await sut.ask("  Yürüyüşe çıkabilir miyim?  ")

        let turn = await sut.currentState().turns.first
        // Trimmed, so a stray space does not become part of the record.
        XCTAssertEqual(turn?.question, "Yürüyüşe çıkabilir miyim?")
    }

    func testAnEmptyQuestionIsNotSent() async {
        let transport = RecordingTransport(bodies: [:])
        let sut = await model(transport)

        await sut.ask("   ")

        let turns = await sut.currentState().turns
        let calls = await transport.made()

        XCTAssertTrue(turns.isEmpty)
        XCTAssertTrue(calls.isEmpty)
    }
}
