package xyz.klinik.feature.messaging

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ApiError
import xyz.klinik.network.ChatMessage
import xyz.klinik.network.ErrorResponse
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.MessagingApi
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher
import xyz.klinik.network.UiText

private class RecordingTransport(
    private val bodies: Map<String, Pair<Int, String>>,
    private val delays: Map<String, Long> = emptyMap(),
) : HttpTransport {
    val calls = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/").substringBefore("?")
        val key = "${request.method} $path"
        calls += key

        delays[key]?.let { delay(it) }

        val (status, body) = bodies[key] ?: (500 to "{}")
        return HttpResponse(status, body)
    }
}

private class FailingTransport(private val error: ApiError) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse = throw error
}

private object UnusedRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("The chat must not refresh")
}

private fun message(
    id: String,
    body: String = "Merhaba",
    status: String = "SENT",
    sender: String = "\"u1\"",
    conversation: String = "c1",
    queuedUntil: String = "null",
) = """
    {"id":"$id","conversationId":"$conversation","senderId":$sender,"type":"TEXT",
     "body":"$body","transcript":null,"status":"$status",
     "queuedUntil":$queuedUntil,"readAt":null,
     "createdAt":"2026-03-01T08:00:00.000Z"}
""".trimIndent()

private const val CONVERSATION = """{"id":"c1","patientId":"p1","subject":null,"lastMessageAt":null}"""

/** One instance, as the socket layer would keep one. */
private val socketJson = Json { ignoreUnknownKeys = true }

private fun arriving(payload: String): ChatMessage = socketJson.decodeFromString(payload)

/**
 * One conversation.
 *
 * The access window is the part worth testing hardest: a patient must know
 * before they write that what they say will be held, and a held message must
 * look held rather than sent.
 */
class ChatModelTest {
    private fun bodies(
        messages: String = "[]",
        clinicOpen: Boolean = true,
        opensAt: String = "null",
        extra: Map<String, Pair<Int, String>> = emptyMap(),
    ): Map<String, Pair<Int, String>> = buildMap {
        put("GET me/conversation", 200 to CONVERSATION)
        put("GET conversations/c1/messages", 200 to """{"items":$messages,"nextCursor":null}""")
        put("GET conversations/clinic-state", 200 to """{"open":$clinicOpen,"opensAt":$opensAt}""")
        putAll(extra)
    }

    private suspend fun model(transport: HttpTransport): ChatModel {
        val session = SessionManager(InMemoryTokenStore(), UnusedRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))
        val api = MessagingApi(ApiClient(ApiConfiguration("https://api.test"), transport, session))

        return ChatModel(api) { api.myConversation() }
    }

    @Test
    fun `loads the conversation`() = runTest {
        val chat = model(RecordingTransport(bodies(messages = "[${message("m1")}]")))

        chat.load()

        val state = chat.state.value

        assertEquals(ChatPhase.Loaded, state.phase)
        assertEquals("c1", state.conversationId)
        assertEquals(listOf("m1"), state.messages.map { it.id })
    }

    /** No messages yet is not a failure. */
    @Test
    fun `reports empty separately from failure`() = runTest {
        val chat = model(RecordingTransport(bodies()))

        chat.load()

        assertEquals(ChatPhase.Empty, chat.state.value.phase)
    }

    /**
     * The compose box has to know before the patient writes. Telling them
     * afterwards is how "queued" feels like the message was lost.
     */
    @Test
    fun `knows the clinic is closed before anything is written`() = runTest {
        val chat = model(
            RecordingTransport(
                bodies(clinicOpen = false, opensAt = "\"2026-03-02T15:00:00.000Z\""),
            ),
        )

        chat.load()

        assertTrue(chat.state.value.willBeQueued)
        assertEquals("2026-03-02T15:00:00.000Z", chat.state.value.clinic?.opensAt)
    }

    /** A held message looks held, not sent. */
    @Test
    fun `shows a queued message as queued`() = runTest {
        val queued = message("m9", status = "QUEUED", queuedUntil = "\"2026-03-02T15:00:00.000Z\"")

        val chat = model(
            RecordingTransport(
                bodies(
                    clinicOpen = false,
                    extra = mapOf(
                        "POST conversations/c1/messages" to (
                            201 to """{"message":$queued,"queuedUntil":"2026-03-02T15:00:00.000Z"}"""
                            ),
                    ),
                ),
            ),
        )

        chat.load()
        val sent = chat.send("Ağrım var")

        assertTrue(sent)
        assertTrue(chat.state.value.messages.last().isQueued)
    }

    @Test
    fun `refuses an empty message`() = runTest {
        val chat = model(RecordingTransport(bodies()))

        chat.load()

        assertFalse(chat.send("   "))
    }

    /**
     * The sender receives its own message twice — from the POST and over the
     * socket. A chat that showed both would be a chat nobody trusted.
     */
    @Test
    fun `does not duplicate a message that also arrives over the socket`() = runTest {
        val chat = model(
            RecordingTransport(
                bodies(
                    extra = mapOf(
                        "POST conversations/c1/messages" to (
                            201 to """{"message":${message("m1")},"queuedUntil":null}"""
                            ),
                    ),
                ),
            ),
        )

        chat.load()
        chat.send("Merhaba")

        chat.receive(arriving(message("m1")))

        assertEquals(1, chat.state.value.messages.size)
    }

    /** A message for another conversation must not land in this one. */
    @Test
    fun `ignores a message for another conversation`() = runTest {
        val chat = model(RecordingTransport(bodies()))

        chat.load()
        chat.receive(arriving(message("m2", conversation = "other")))

        assertTrue(chat.state.value.messages.isEmpty())
    }

    @Test
    fun `tracks who is typing`() = runTest {
        val chat = model(RecordingTransport(bodies()))

        chat.setTyping("u2", true)
        assertTrue(chat.state.value.typing.contains("u2"))

        chat.setTyping("u2", false)
        assertFalse(chat.state.value.typing.contains("u2"))
    }

    /** A message from someone clears their typing indicator: they have stopped. */
    @Test
    fun `a message clears the sender typing indicator`() = runTest {
        val chat = model(RecordingTransport(bodies()))

        chat.load()
        chat.setTyping("u1", true)
        chat.receive(arriving(message("m3")))

        assertFalse(chat.state.value.typing.contains("u1"))
    }

    /** A double tap must not send the same message twice. */
    @Test
    fun `refuses a second send while one is in flight`() = runTest {
        val transport = RecordingTransport(
            bodies(
                extra = mapOf(
                    "POST conversations/c1/messages" to (
                        201 to """{"message":${message("m1")},"queuedUntil":null}"""
                        ),
                ),
            ),
            delays = mapOf("POST conversations/c1/messages" to 300),
        )
        val chat = model(transport)

        chat.load()

        val first = async { chat.send("Merhaba") }
        val second = async { chat.send("Merhaba") }

        val results = listOf(first.await(), second.await())

        assertEquals(1, results.count { it })
        assertEquals(1, transport.calls.count { it == "POST conversations/c1/messages" })
    }

    @Test
    fun `keeps the server message when sending is refused`() = runTest {
        val chat = model(
            RecordingTransport(
                bodies(
                    extra = mapOf(
                        "POST conversations/c1/messages" to (
                            400 to """{"statusCode":400,"message":"A message needs text or an attachment"}"""
                            ),
                    ),
                ),
            ),
        )

        chat.load()
        val sent = chat.send("Merhaba")

        assertFalse(sent)
        assertEquals(
            UiText.Literal("A message needs text or an attachment"),
            chat.state.value.error,
        )
    }

    @Test
    fun `treats not found as its own state`() = runTest {
        val chat = model(FailingTransport(ApiError.NotFound(ErrorResponse(statusCode = 404))))

        chat.load()

        assertEquals(ChatPhase.NotFound, chat.state.value.phase)
    }

    @Test
    fun `knows there are older messages`() = runTest {
        val chat = model(
            RecordingTransport(
                mapOf(
                    "GET me/conversation" to (200 to CONVERSATION),
                    "GET conversations/c1/messages" to (
                        200 to """{"items":[${message("m2")}],"nextCursor":"m2"}"""
                        ),
                    "GET conversations/clinic-state" to (200 to """{"open":true,"opensAt":null}"""),
                ),
            ),
        )

        chat.load()

        assertTrue(chat.state.value.hasOlder)
    }
}
