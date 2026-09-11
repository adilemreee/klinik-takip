package xyz.klinik.feature.consents

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
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

private object PatientConsentRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading consents must not refresh a session")
}

private class ConsentTransport(private val bodies: Map<String, Pair<Int, String>>) : HttpTransport {
    val paths = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        paths += path

        val (status, body) = bodies[path.substringBefore("?")] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private fun consent(
    id: String,
    type: String,
    active: Boolean,
    signature: Boolean,
    signedAt: String,
) = """
    {"id":"$id","patientId":"p1","type":"$type","version":1,"signedAt":"$signedAt",
     "revokedAt":${if (active) "null" else "\"2026-09-05T08:00:00.000Z\""},
     "active":$active,"hasSignature":$signature}
""".trimIndent()

/**
 * What a patient agreed to, read by the clinic.
 *
 * A withdrawal is a thing that happened and stays visible; a signature is
 * fetched only where one exists, because a link for a consent without one can
 * only fail and the failure would read as a lost signature.
 */
class PatientConsentsModelTest {
    private suspend fun model(transport: ConsentTransport): PatientConsentsModel {
        val session = SessionManager(InMemoryTokenStore(), PatientConsentRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return PatientConsentsModel(
            ConsentsApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
            patientId = "p1",
        )
    }

    /**
     * A consent given and taken back is not the same as one never given, and
     * a clinician who cannot see the withdrawal will read it as the latter.
     */
    @Test
    fun `a withdrawn consent stays on the screen`() = runTest {
        val subject = model(
            ConsentTransport(
                mapOf(
                    "patients/p1/consents" to (
                        200 to "[" + listOf(
                            consent("c1", "PHOTO_USAGE", true, true, "2026-09-01T08:00:00.000Z"),
                            consent("c2", "MARKETING", false, false, "2026-08-01T08:00:00.000Z"),
                        ).joinToString(",") + "]"
                        ),
                ),
            ),
        )

        subject.load()

        assertEquals(listOf("c1"), subject.state.value.inForce.map { it.id })
        assertEquals(listOf("c2"), subject.state.value.withdrawn.map { it.id })
    }

    /** Newest first: the record somebody came to check is the most recent. */
    @Test
    fun `the most recent record is first`() = runTest {
        val subject = model(
            ConsentTransport(
                mapOf(
                    "patients/p1/consents" to (
                        200 to "[" + listOf(
                            consent("old", "MARKETING", true, false, "2026-01-01T08:00:00.000Z"),
                            consent("new", "PHOTO_USAGE", true, false, "2026-09-01T08:00:00.000Z"),
                        ).joinToString(",") + "]"
                        ),
                ),
            ),
        )

        subject.load()

        assertEquals(listOf("new", "old"), subject.state.value.consents.map { it.id })
    }

    /**
     * No link is asked for where the record says there is no signature.
     *
     * A request that can only fail reads, to whoever pressed it, as a
     * signature the clinic has lost.
     */
    @Test
    fun `no signature means no request`() = runTest {
        val transport = ConsentTransport(
            mapOf(
                "patients/p1/consents" to (
                    200 to "[${consent("c2", "MARKETING", true, false, "2026-08-01T08:00:00.000Z")}]"
                    ),
            ),
        )
        val subject = model(transport)

        subject.load()

        assertNull(subject.signatureLink(subject.state.value.consents.single()))
        assertTrue(transport.paths.none { it.contains("signature") })
    }

    @Test
    fun `a recorded signature is fetched when asked for`() = runTest {
        val subject = model(
            ConsentTransport(
                mapOf(
                    "patients/p1/consents" to (
                        200 to "[${consent("c1", "PHOTO_USAGE", true, true, "2026-09-01T08:00:00.000Z")}]"
                        ),
                    "patients/p1/consents/c1/signature" to (
                        200 to """{"url":"https://files.test/sig.png","expiresAt":"2026-09-12T10:00:00.000Z"}"""
                        ),
                ),
            ),
        )

        subject.load()

        assertEquals(
            "https://files.test/sig.png",
            subject.signatureLink(subject.state.value.consents.single()),
        )
    }

    /** Nothing on record is an answer about the patient, not a failure. */
    @Test
    fun `no consents at all is its own state`() = runTest {
        val subject = model(ConsentTransport(mapOf("patients/p1/consents" to (200 to "[]"))))

        subject.load()

        assertEquals(PatientConsentsPhase.Empty, subject.state.value.phase)
    }
}
