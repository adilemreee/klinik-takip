package xyz.klinik.feature.messaging

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.MessageType
import xyz.klinik.network.MessagingApi
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object InboxRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading the inbox must not refresh a session")
}

private class InboxTransport(private val status: Int, private val body: String) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse = HttpResponse(status, body)
}

private fun entry(id: String, name: String, unread: Int, sentAt: String) = """
    {"conversation":{"id":"$id","patientId":"p-$id","subject":null,
      "lastMessageAt":"$sentAt"},
     "patient":{"id":"p-$id","mrn":"2026-$id","fullName":"$name"},
     "lastMessage":{"body":"Merhaba","sentAt":"$sentAt","type":"TEXT"},
     "unread":$unread}
""".trimIndent()

/**
 * The clinic's conversations (spec M6).
 *
 * The row used to decode into a bare conversation, which threw away the
 * patient, the last message and the unread count — everything a row is read
 * for. These tests are mostly about none of that going missing again.
 */
class InboxModelTest {
    private suspend fun model(vararg entries: String, status: Int = 200): InboxModel {
        val session = SessionManager(InMemoryTokenStore(), InboxRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        val body = if (status == 200) "[${entries.joinToString(",")}]" else """{"message":"no"}"""

        return InboxModel(
            MessagingApi(
                ApiClient(
                    ApiConfiguration("https://api.test"),
                    InboxTransport(status, body),
                    session,
                ),
            ),
        )
    }

    /** The row names the patient, not an identifier. */
    @Test
    fun `a row carries the patient and the last message`() = runTest {
        val subject = model(entry("c1", "Ayşe Yılmaz", 2, "2026-09-12T08:00:00.000Z"))

        subject.load()

        val row = subject.state.value.entries.single()

        assertEquals("Ayşe Yılmaz", row.patient.fullName)
        assertEquals("2026-c1", row.patient.mrn)
        assertEquals("Merhaba", row.lastMessage?.body)
        assertEquals(MessageType.TEXT, row.lastMessage?.type)
        assertEquals(2, row.unread)
    }

    /**
     * Waiting on the clinic is its own list — the question an inbox is opened
     * to answer — and the rest stay below rather than disappearing.
     */
    @Test
    fun `unread conversations are separated without hiding the others`() = runTest {
        val subject = model(
            entry("c1", "Ayşe", 3, "2026-09-12T08:00:00.000Z"),
            entry("c2", "Mehmet", 0, "2026-09-11T08:00:00.000Z"),
        )

        subject.load()

        assertEquals(listOf("c1"), subject.state.value.unread.map { it.conversation.id })
        assertEquals(listOf("c2"), subject.state.value.read.map { it.conversation.id })
        assertEquals(3, subject.state.value.unreadCount)
    }

    /** The server's order is kept: most recent first. */
    @Test
    fun `the server's order is not re-sorted`() = runTest {
        val subject = model(
            entry("newest", "Ayşe", 0, "2026-09-12T08:00:00.000Z"),
            entry("older", "Mehmet", 0, "2026-09-01T08:00:00.000Z"),
        )

        subject.load()

        assertEquals(
            listOf("newest", "older"),
            subject.state.value.entries.map { it.conversation.id },
        )
    }

    /** An attachment with no text still has a last message. */
    @Test
    fun `a message with no body is still a message`() = runTest {
        val subject = model(
            entry("c1", "Ayşe", 1, "2026-09-12T08:00:00.000Z")
                .replace("\"body\":\"Merhaba\"", "\"body\":null")
                .replace("\"type\":\"TEXT\"", "\"type\":\"IMAGE\""),
        )

        subject.load()

        val last = subject.state.value.entries.single().lastMessage

        assertEquals(null, last?.body)
        assertEquals(MessageType.IMAGE, last?.type)
    }

    /** Nothing open is a finished inbox, not a failure. */
    @Test
    fun `an empty inbox is its own state`() = runTest {
        val subject = model()

        subject.load()

        assertEquals(InboxPhase.Empty, subject.state.value.phase)
        assertTrue(subject.state.value.entries.isEmpty())
    }

    @Test
    fun `a forbidden account is told so rather than shown an error`() = runTest {
        val subject = model(status = 403)

        subject.load()

        assertEquals(InboxPhase.NotPermitted, subject.state.value.phase)
    }
}
