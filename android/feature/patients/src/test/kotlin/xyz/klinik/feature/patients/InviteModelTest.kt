package xyz.klinik.feature.patients

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.AuthApi
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object InviteRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Issuing an invitation must not refresh a session")
}

private class InviteTransport(private val status: Int, private val body: String) : HttpTransport {
    val sent = mutableListOf<Pair<String, String>>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        sent += "${request.method} ${request.url.substringAfter("https://api.test/")}" to
            request.body.orEmpty()

        return HttpResponse(status, body)
    }
}

private const val ISSUED = """
    {"id":"i1","code":"482913","expiresAt":"2026-09-19T08:00:00.000Z"}
"""

/**
 * Inviting a patient into the app (spec T7.3).
 *
 * The code comes back once and only its hash is stored, so what the model must
 * not do is lose it or ask for a second one by accident.
 */
class InviteModelTest {
    private suspend fun model(
        transport: InviteTransport = InviteTransport(201, ISSUED),
    ): Pair<InviteModel, InviteTransport> {
        val session = SessionManager(InMemoryTokenStore(), InviteRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        val model = InviteModel(
            AuthApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
            patientId = "p1",
        )

        return model to transport
    }

    /** One of the two is enough; neither is not. */
    @Test
    fun `an invitation needs a way to reach somebody`() = runTest {
        val (subject, transport) = model()

        assertTrue(InviteProblem.NoContact in subject.state.value.problems)
        assertFalse(subject.invite())
        assertTrue(transport.sent.isEmpty())

        subject.edit(phone = "+905550000000")

        assertTrue(subject.state.value.canSubmit)
    }

    /**
     * The address is checked only when there is one.
     *
     * An invitation by phone alone is ordinary, and complaining about an empty
     * e-mail box is complaining about a field nobody filled in.
     */
    @Test
    fun `an empty e-mail is not a bad one`() = runTest {
        val (subject, _) = model()

        subject.edit(phone = "+905550000000")
        assertFalse(InviteProblem.BadEmail in subject.state.value.problems)

        subject.edit(email = "ayse.example.com")
        assertTrue(InviteProblem.BadEmail in subject.state.value.problems)
    }

    /** The file the invitation is for travels with it, and the role is fixed. */
    @Test
    fun `the invitation names the patient's own file`() = runTest {
        val (subject, transport) = model()

        subject.edit(email = "ayse@example.com")
        subject.invite()

        val body = transport.sent.single().second

        assertTrue("\"patientId\":\"p1\"" in body, body)
        assertTrue("\"role\":\"PATIENT\"" in body, body)
    }

    /**
     * The code stays on screen until somebody dismisses it.
     *
     * Only its hash is stored; a code scrolled away is a patient who cannot
     * sign in and a clinic that has to issue another.
     */
    @Test
    fun `the code is kept until it is dismissed`() = runTest {
        val (subject, _) = model()

        subject.edit(email = "ayse@example.com")
        assertTrue(subject.invite())

        assertEquals("482913", subject.state.value.issued?.code)
        // And no second one can be issued by accident while it is showing.
        assertFalse(subject.state.value.canSubmit)

        subject.dismiss()
        assertEquals(null, subject.state.value.issued)
    }

    @Test
    fun `a refused invitation says why and issues nothing`() = runTest {
        val (subject, _) = model(InviteTransport(403, """{"message":"forbidden"}"""))

        subject.edit(email = "ayse@example.com")

        assertFalse(subject.invite())
        assertEquals(null, subject.state.value.issued)
        assertNotNull(subject.state.value.error)
    }
}
