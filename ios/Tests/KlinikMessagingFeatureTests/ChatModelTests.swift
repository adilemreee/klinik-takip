import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikMessagingFeature

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

private func message(
    _ id: String,
    body: String = "Merhaba",
    status: String = "SENT",
    sender: String = "\"u1\"",
    queuedUntil: String = "null"
) -> String {
    """
    {"id":"\(id)","conversationId":"c1","senderId":\(sender),"type":"TEXT",
     "body":"\(body)","transcript":null,"status":"\(status)",
     "queuedUntil":\(queuedUntil),"readAt":null,
     "createdAt":"2026-03-01T08:00:00.000Z"}
    """
}

private let conversationBody = """
{"id":"c1","patientId":"p1","subject":null,"lastMessageAt":null}
"""

/**
 * One conversation.
 *
 * The access window is the part worth testing hardest: a patient must know
 * before they write that what they say will be held, and a held message must
 * look held rather than sent.
 */
final class ChatModelTests: XCTestCase {
    private func model(_ transport: HTTPTransport) async -> ChatModel {
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
        let api = MessagingAPI(client: client)

        return ChatModel(api: api) { try await api.myConversation() }
    }

    private func bodies(
        messages: String = "[]",
        clinicOpen: Bool = true,
        opensAt: String = "null",
        extra: [String: (Int, String)] = [:]
    ) -> [String: (Int, String)] {
        var map: [String: (Int, String)] = [
            "GET /me/conversation": (200, conversationBody),
            "GET /conversations/c1/messages": (
                200, "{\"items\":\(messages),\"nextCursor\":null}"
            ),
            "GET /conversations/clinic-state": (
                200, "{\"open\":\(clinicOpen),\"opensAt\":\(opensAt)}"
            ),
        ]

        for (key, value) in extra { map[key] = value }
        return map
    }

    func testLoadsTheConversation() async {
        let chat = await model(
            RecordingTransport(bodies: bodies(messages: "[\(message("m1"))]"))
        )

        await chat.load()

        let state = await chat.currentState()

        XCTAssertEqual(state.phase, .loaded)
        XCTAssertEqual(state.conversationId, "c1")
        XCTAssertEqual(state.messages.map(\.id), ["m1"])
    }

    /// No messages yet is not a failure.
    func testReportsEmptySeparatelyFromFailure() async {
        let chat = await model(RecordingTransport(bodies: bodies()))

        await chat.load()

        let phase = await chat.currentState().phase
        XCTAssertEqual(phase, .empty)
    }

    /**
     * The compose box has to know before the patient writes. Telling them
     * afterwards is how "queued" feels like the message was lost.
     */
    func testKnowsTheClinicIsClosedBeforeAnythingIsWritten() async {
        let chat = await model(
            RecordingTransport(
                bodies: bodies(clinicOpen: false, opensAt: "\"2026-03-02T15:00:00.000Z\"")
            )
        )

        await chat.load()

        let state = await chat.currentState()

        XCTAssertTrue(state.willBeQueued)
        XCTAssertNotNil(state.clinic?.opensAt)
    }

    /// A held message looks held, not sent.
    func testShowsAQueuedMessageAsQueued() async {
        let queued = message(
            "m9",
            status: "QUEUED",
            queuedUntil: "\"2026-03-02T15:00:00.000Z\""
        )

        let chat = await model(
            RecordingTransport(
                bodies: bodies(
                    clinicOpen: false,
                    extra: [
                        "POST /conversations/c1/messages": (
                            201, "{\"message\":\(queued),\"queuedUntil\":\"2026-03-02T15:00:00.000Z\"}"
                        ),
                    ]
                )
            )
        )

        await chat.load()
        let sent = await chat.send("Ağrım var")

        let state = await chat.currentState()

        XCTAssertTrue(sent)
        XCTAssertTrue(state.messages.last!.isQueued)
        XCTAssertNotNil(state.messages.last!.queuedUntil)
    }

    func testRefusesAnEmptyMessage() async {
        let chat = await model(RecordingTransport(bodies: bodies()))

        await chat.load()
        let sent = await chat.send("   ")

        XCTAssertFalse(sent)
    }

    /**
     * The sender receives its own message twice — from the POST and over the
     * socket. A chat that showed both would be a chat nobody trusted.
     */
    func testDoesNotDuplicateAMessageThatAlsoArrivesOverTheSocket() async {
        let chat = await model(
            RecordingTransport(
                bodies: bodies(
                    extra: [
                        "POST /conversations/c1/messages": (
                            201, "{\"message\":\(message("m1")),\"queuedUntil\":null}"
                        ),
                    ]
                )
            )
        )

        await chat.load()
        await chat.send("Merhaba")

        // The same message, arriving again over the socket.
        let decoded = try! JSONDecoder.klinik.decode(
            ChatMessage.self,
            from: Data(message("m1").utf8)
        )
        await chat.receive(decoded)

        let messages = await chat.currentState().messages

        XCTAssertEqual(messages.count, 1)
    }

    /// A message for another conversation must not land in this one.
    func testIgnoresAMessageForAnotherConversation() async {
        let chat = await model(RecordingTransport(bodies: bodies()))

        await chat.load()

        let other = try! JSONDecoder.klinik.decode(
            ChatMessage.self,
            from: Data(
                message("m2").replacingOccurrences(of: "\"conversationId\":\"c1\"", with: "\"conversationId\":\"other\"").utf8
            )
        )
        await chat.receive(other)

        let messages = await chat.currentState().messages
        XCTAssertTrue(messages.isEmpty)
    }

    func testTracksWhoIsTyping() async {
        let chat = await model(RecordingTransport(bodies: bodies()))

        await chat.setTyping("u2", isTyping: true)
        var typing = await chat.currentState().typing
        XCTAssertTrue(typing.contains("u2"))

        await chat.setTyping("u2", isTyping: false)
        typing = await chat.currentState().typing
        XCTAssertFalse(typing.contains("u2"))
    }

    /// A message from someone clears their typing indicator: they have stopped.
    func testAMessageClearsTheSenderTypingIndicator() async {
        let chat = await model(RecordingTransport(bodies: bodies()))

        await chat.load()
        await chat.setTyping("u1", isTyping: true)

        let arrived = try! JSONDecoder.klinik.decode(
            ChatMessage.self,
            from: Data(message("m3").utf8)
        )
        await chat.receive(arrived)

        let typing = await chat.currentState().typing
        XCTAssertFalse(typing.contains("u1"))
    }

    /// A double tap must not send the same message twice.
    func testRefusesASecondSendWhileOneIsInFlight() async {
        let transport = RecordingTransport(
            bodies: bodies(
                extra: [
                    "POST /conversations/c1/messages": (
                        201, "{\"message\":\(message("m1")),\"queuedUntil\":null}"
                    ),
                ]
            ),
            delays: ["POST /conversations/c1/messages": .milliseconds(200)]
        )
        let chat = await model(transport)

        await chat.load()

        async let first = chat.send("Merhaba")
        async let second = chat.send("Merhaba")

        let results = await [first, second]
        let calls = await transport.made()

        XCTAssertEqual(results.filter { $0 }.count, 1)
        XCTAssertEqual(calls.filter { $0 == "POST /conversations/c1/messages" }.count, 1)
    }

    func testKeepsTheServerMessageWhenSendingIsRefused() async {
        let chat = await model(
            RecordingTransport(
                bodies: bodies(
                    extra: [
                        "POST /conversations/c1/messages": (
                            400, "{\"statusCode\":400,\"message\":\"A message needs text or an attachment\"}"
                        ),
                    ]
                )
            )
        )

        await chat.load()
        let sent = await chat.send("Merhaba")

        let error = await chat.currentState().error

        XCTAssertFalse(sent)
        XCTAssertEqual(error, "A message needs text or an attachment")
    }

    func testTreatsNotFoundAsItsOwnState() async {
        let chat = await model(
            FailingTransport(error: .notFound(ErrorResponse(statusCode: 404, message: "")))
        )

        await chat.load()

        let phase = await chat.currentState().phase
        XCTAssertEqual(phase, .notFound)
    }

    func testLoadsOlderMessagesInFront() async {
        let transport = RecordingTransport(bodies: [
            "GET /me/conversation": (200, conversationBody),
            "GET /conversations/c1/messages": (
                200, "{\"items\":[\(message("m2"))],\"nextCursor\":\"m2\"}"
            ),
            "GET /conversations/clinic-state": (200, "{\"open\":true,\"opensAt\":null}"),
        ])
        let chat = await model(transport)

        await chat.load()
        let hasOlder = await chat.currentState().hasOlder
        XCTAssertTrue(hasOlder)
    }
}
