package xyz.klinik.feature.consents

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ConsentsApi
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object FormRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading a consent form must not refresh a session")
}

private class FormTransport(private val bodies: Map<String, Pair<Int, String>>) : HttpTransport {
    val sent = mutableListOf<Pair<String, String>>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        sent += "${request.method} $path" to request.body.orEmpty()

        val (status, body) = bodies["${request.method} $path"] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private const val FORM = """
    {"id":"treatment-consent","version":3,
     "body":"## Rinoplasti\nBu işlemin riskleri…"}
"""

private const val RECORDED = """
    {"id":"c1","patientId":"p1","type":"TREATMENT","version":3,
     "signedAt":"2026-09-12T08:00:00.000Z","revokedAt":null,"active":true,
     "hasSignature":true}
"""

/**
 * The treatment consent (KVKK, spec §8).
 *
 * Two gates, and both are the point: a consent nobody read is not informed,
 * and a consent record with a blank where the mark should be is one the clinic
 * cannot stand behind.
 */
class ConsentFormModelTest {
    private suspend fun model(transport: FormTransport): ConsentFormModel {
        val session = SessionManager(InMemoryTokenStore(), FormRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return ConsentFormModel(
            ConsentsApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
        )
    }

    private fun loaded() = FormTransport(
        mapOf(
            "GET me/consents/form" to (200 to FORM),
            "POST me/consents" to (200 to RECORDED),
        ),
    )

    /** Unread is not signable, however ready the rest of the form looks. */
    @Test
    fun `the text has to be read to the end`() = runTest {
        val transport = loaded()
        val subject = model(transport)

        subject.load()
        subject.setSigned(true)

        assertFalse(subject.state.value.canSubmit)
        assertFalse(subject.sign("ABC"))
        assertTrue(transport.sent.none { it.first.startsWith("POST") })
    }

    /** And neither is unsigned. */
    @Test
    fun `a mark has to have been made`() = runTest {
        val transport = loaded()
        val subject = model(transport)

        subject.load()
        subject.markReadToEnd()

        assertFalse(subject.state.value.canSubmit)
        assertFalse(subject.sign(null))
        assertTrue(transport.sent.none { it.first.startsWith("POST") })
    }

    /**
     * The text that was shown goes back with the consent.
     *
     * A version names a wording; this is what this person actually saw, and it
     * is what can be produced years later.
     */
    @Test
    fun `the consent carries the text and the signature`() = runTest {
        val transport = loaded()
        val subject = model(transport)

        subject.load()
        subject.markReadToEnd()
        subject.setSigned(true)

        assertTrue(subject.sign("QkFTRTY0"))

        val body = transport.sent.last { it.first.startsWith("POST") }.second

        assertTrue("TREATMENT" in body, body)
        assertTrue("\"version\":3" in body, body)
        assertTrue("Rinoplasti" in body, body)
        assertTrue("QkFTRTY0" in body, body)
        assertEquals(ConsentFormPhase.Signed, subject.state.value.phase)
    }

    /**
     * No text published is its own state.
     *
     * A form that names no procedure is not a valid informed consent, so the
     * server withholds it rather than sending a template with a blank in it.
     */
    @Test
    fun `an unpublished form is not an error`() = runTest {
        val subject = model(
            FormTransport(
                mapOf("GET me/consents/form" to (404 to """{"message":"not found"}""")),
            ),
        )

        subject.load()

        assertEquals(ConsentFormPhase.Unpublished, subject.state.value.phase)
    }

    /**
     * A failed send keeps the form and the signature.
     *
     * Asking somebody to read a consent form and sign it twice because the
     * network dropped is how people stop reading it.
     */
    @Test
    fun `a failed send keeps the signature`() = runTest {
        val subject = model(
            FormTransport(
                mapOf(
                    "GET me/consents/form" to (200 to FORM),
                    "POST me/consents" to (500 to "{}"),
                ),
            ),
        )

        subject.load()
        subject.markReadToEnd()
        subject.setSigned(true)

        assertFalse(subject.sign("QkFTRTY0"))
        assertTrue(subject.state.value.signed)
        assertTrue(subject.state.value.readToEnd)
        assertNotNull(subject.state.value.error)
    }
}
