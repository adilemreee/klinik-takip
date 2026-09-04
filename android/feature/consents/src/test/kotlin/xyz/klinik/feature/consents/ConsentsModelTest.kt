package xyz.klinik.feature.consents

import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ConsentType
import xyz.klinik.network.ConsentsApi
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.InMemoryTokenStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Giving and withdrawing consent (KVKK).
 *
 * The rules under test are legal ones, and each is a way the screen could look
 * correct while being wrong.
 */
class ConsentsModelTest {
    private val sent = mutableListOf<String>()

    private suspend fun model(vararg bodies: String): ConsentsModel {
        val queue = bodies.toMutableList()
        val transport = HttpTransport { request ->
            sent += "${request.method} ${request.url} ${request.body.orEmpty()}"
            HttpResponse(if (queue.isEmpty()) 200 else 200, queue.removeFirstOrNull() ?: "[]")
        }

        val session = SessionManager(InMemoryTokenStore()) { error("no refresh") }
        session.signIn(SessionTokens("a", "r", System.currentTimeMillis() + 900_000))

        val client = ApiClient(ApiConfiguration("https://api.test"), transport, session)

        return ConsentsModel(ConsentsApi(client), version = 3)
    }

    private fun consent(type: String, active: Boolean = true, revoked: String? = null) = """
        {"id":"c-$type","patientId":"p1","type":"$type","version":3,
         "signedAt":"2026-09-01T10:00:00.000Z",
         "revokedAt":${revoked?.let { "\"$it\"" } ?: "null"},"active":$active}
    """.trimIndent()

    @Test
    fun `the askable set excludes what must not be asked`() {
        // Treatment is signed at the clinic. Data processing rests on the
        // health-care ground in law, and Board decision 2026/347 forbids
        // putting a consent text in front of somebody where it applies:
        // asking suggests a refusal is possible when refusing costs them their
        // treatment, which makes the consent void.
        assertEquals(listOf(ConsentType.PHOTO_USAGE, ConsentType.MARKETING), ConsentType.askable)
        assertFalse(ConsentType.DATA_PROCESSING in ConsentType.askable)
        assertFalse(ConsentType.TREATMENT in ConsentType.askable)
    }

    @Test
    fun `refuses to send a consent that must not be asked`() = runTest {
        // The server refuses it too. Both, because a client that sends it is a
        // client somebody could point at a laxer server.
        val subject = model()

        assertFalse(subject.give(ConsentType.DATA_PROCESSING))
        assertTrue(sent.isEmpty(), "nothing should have been sent")
    }

    @Test
    fun `sends the version that was agreed to`() = runTest {
        // "They agreed" names nothing without it, and a text changed later must
        // not silently inherit agreement to the old one.
        val subject = model(consent("PHOTO_USAGE"), "[${consent("PHOTO_USAGE")}]")

        subject.give(ConsentType.PHOTO_USAGE)

        val post = sent.first { it.startsWith("POST") }
        assertTrue(post.contains("\"version\":3"), post)
        assertTrue(post.contains("PHOTO_USAGE"), post)
    }

    @Test
    fun `a withdrawn consent is not active but is still there`() = runTest {
        // Forward-only: proving a consent existed while it was relied on is the
        // controller's burden, and a row that vanished proves nothing.
        val subject = model(
            "[${consent("MARKETING", active = false, revoked = "2026-09-03T08:00:00.000Z")}]",
        )

        subject.load()
        val state = subject.state.value

        assertNull(state.active(ConsentType.MARKETING), "a withdrawn consent is not in force")
        assertNotNull(state.latest(ConsentType.MARKETING), "but the record is still there")
        assertNotNull(state.latest(ConsentType.MARKETING)?.revokedAt)
    }

    @Test
    fun `withdrawing something never given does nothing`() = runTest {
        val subject = model("[]")

        subject.load()
        val before = sent.size

        assertFalse(subject.withdraw(ConsentType.PHOTO_USAGE))
        assertEquals(before, sent.size, "no delete for a consent that does not exist")
    }
}
