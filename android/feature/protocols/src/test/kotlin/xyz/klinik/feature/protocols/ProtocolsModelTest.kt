package xyz.klinik.feature.protocols

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.ProtocolsApi
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object ProtocolRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading protocols must not refresh a session")
}

private class ProtocolTransport(private val bodies: Map<String, Pair<Int, String>>) : HttpTransport {
    val sent = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        sent += "${request.method} $path"

        val (status, body) = bodies["${request.method} $path"] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private fun document(
    id: String,
    active: Boolean = true,
    embedded: Boolean = true,
    chunks: Int = 9,
    createdAt: String = "2026-09-01T08:00:00.000Z",
) = """
    {"document":{"id":"$id","title":"Taburculuk","procedureType":null,"language":"tr",
      "isActive":$active,"createdAt":"$createdAt"},"chunks":$chunks,"embedded":$embedded}
""".trimIndent()

private val LONG_ENOUGH = "Ameliyattan sonraki ilk hafta boyunca ".repeat(4)

/**
 * What the assistant is allowed to answer from (spec M4).
 *
 * The assistant answers from these and hands everything else to a person, so
 * the list is the whole of what it knows — and a document it cannot read is
 * worse than no document, because it looks like one that works.
 */
class ProtocolsModelTest {
    private fun transport(vararg bodies: Pair<String, Pair<Int, String>>) =
        ProtocolTransport(bodies.toMap())

    private suspend fun model(transport: ProtocolTransport): ProtocolsModel {
        val session = SessionManager(InMemoryTokenStore(), ProtocolRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return ProtocolsModel(
            ProtocolsApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
        )
    }

    /**
     * A stored document the assistant cannot retrieve is kept apart.
     *
     * It is indistinguishable from a working one, and a clinic reading one
     * list would believe its assistant had been taught something it has never
     * read.
     */
    @Test
    fun `an unindexed document is listed separately from a usable one`() = runTest {
        val subject = model(
            transport(
                "GET protocols" to (
                    200 to "[${document("ok")},${document("blind", embedded = false)}]"
                    ),
            ),
        )

        subject.load()

        assertEquals(listOf("ok"), subject.state.value.usable.map { it.document.id })
        assertEquals(listOf("blind"), subject.state.value.unusable.map { it.document.id })
    }

    /**
     * No documents is a sentence, not an empty list.
     *
     * The assistant in that state forwards every question to the clinic, which
     * is worth saying out loud.
     */
    @Test
    fun `no documents is its own state`() = runTest {
        val subject = model(transport("GET protocols" to (200 to "[]")))

        subject.load()

        assertEquals(ProtocolsPhase.Empty, subject.state.value.phase)
    }

    /** Archived documents stay out of the way until asked for. */
    @Test
    fun `retired documents are hidden until shown`() = runTest {
        val subject = model(
            transport(
                "GET protocols" to (200 to "[${document("live")},${document("old", active = false)}]"),
            ),
        )

        subject.load()

        assertEquals(listOf("live"), subject.state.value.usable.map { it.document.id })
        assertTrue(subject.state.value.unusable.isEmpty())

        subject.showRetired(true)

        assertEquals(listOf("old"), subject.state.value.unusable.map { it.document.id })
    }

    /**
     * A two-word protocol still embeds, and the assistant will cite it.
     *
     * So the refusal happens here rather than as a surprise in an answer to a
     * patient.
     */
    @Test
    fun `a document too short to cite is refused before it is sent`() = runTest {
        val transport = transport("GET protocols" to (200 to "[]"))
        val subject = model(transport)

        subject.load()

        assertEquals(ProtocolDraftProblem.TooShort, subject.check("Başlık", "Çok kısa"))
        assertFalse(subject.upload("Başlık", "Çok kısa", null))
        assertTrue(transport.sent.none { it.startsWith("POST") })
    }

    @Test
    fun `a document with no title is refused`() = runTest {
        val subject = model(transport("GET protocols" to (200 to "[]")))

        subject.load()

        assertEquals(ProtocolDraftProblem.NoTitle, subject.check("   ", LONG_ENOUGH))
    }

    @Test
    fun `an accepted document joins the list at the top`() = runTest {
        val subject = model(
            transport(
                "GET protocols" to (200 to "[${document("old")}]"),
                "POST protocols" to (200 to document("new", createdAt = "2026-09-12T08:00:00.000Z")),
            ),
        )

        subject.load()
        assertTrue(subject.upload("Taburculuk", LONG_ENOUGH, procedureType = null))

        assertEquals(listOf("new", "old"), subject.state.value.usable.map { it.document.id })
    }

    @Test
    fun `withdrawing a document removes it from the list`() = runTest {
        val subject = model(
            transport(
                "GET protocols" to (200 to "[${document("d1")}]"),
                "DELETE protocols/d1" to (204 to ""),
            ),
        )

        subject.load()
        assertTrue(subject.retire("d1"))

        assertEquals(ProtocolsPhase.Empty, subject.state.value.phase)
    }

    @Test
    fun `a forbidden account is told so rather than shown an error`() = runTest {
        val subject = model(transport("GET protocols" to (403 to """{"message":"forbidden"}""")))

        subject.load()

        assertEquals(ProtocolsPhase.NotPermitted, subject.state.value.phase)
    }
}
