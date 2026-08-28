package xyz.klinik.feature.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ApiError
import xyz.klinik.network.AuthApi
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private class ScriptedTransport(responses: List<HttpResponse>) : HttpTransport {
    private val queue = ArrayDeque(responses)
    val requests = mutableListOf<HttpRequest>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        requests += request
        return if (queue.isEmpty()) HttpResponse(500, "{}") else queue.removeFirst()
    }
}

private class OfflineTransport : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse = throw ApiError.Offline
}

private object UnusedRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("The sign-in flow must not refresh")
}

class AuthFlowTest {
    private val success =
        """{"status":"OK","accessToken":"a","refreshToken":"r","expiresIn":900}"""

    private fun flow(
        responses: List<HttpResponse>,
        transport: HttpTransport = ScriptedTransport(responses),
    ): Triple<AuthFlowModel, HttpTransport, SessionManager> {
        val session = SessionManager(InMemoryTokenStore(), UnusedRefresher)
        val client = ApiClient(ApiConfiguration("https://api.test"), transport, session)
        return Triple(AuthFlowModel(AuthApi(client), session), transport, session)
    }

    @Test
    fun `signs in when no second factor is required`() = runTest {
        val (model, _, session) = flow(listOf(HttpResponse(200, success)))

        model.submitCredentials("patient@test.local", "pw", "Pixel")

        assertEquals(AuthStep.SignedIn, model.state.value.step)
        assertNull(model.state.value.errorKey)
        assertEquals("a", session.currentTokens()?.accessToken)
    }

    @Test
    fun `asks for a code when the account has a second factor`() = runTest {
        val (model, _, _) = flow(listOf(HttpResponse(200, """{"status":"MFA_REQUIRED"}""")))

        model.submitCredentials("doctor@test.local", "pw")

        assertEquals(AuthStep.TwoFactorCode, model.state.value.step)
    }

    /** The user should not retype their password for the second factor. */
    @Test
    fun `remembers the credentials for the code step`() = runTest {
        val transport = ScriptedTransport(
            listOf(HttpResponse(200, """{"status":"MFA_REQUIRED"}"""), HttpResponse(200, success)),
        )
        val (model, _, _) = flow(emptyList(), transport)

        model.submitCredentials("doctor@test.local", "secret-pw")
        model.submitTwoFactorCode("123456")

        assertEquals(AuthStep.SignedIn, model.state.value.step)

        val body = transport.requests[1].body!!
        assertTrue(body.contains("secret-pw"), "the password should be reused, not retyped")
        assertTrue(body.contains("123456"), "the code should be sent with it")
    }

    /**
     * Staff with no second factor: the login returns no session, only a token
     * that can enrol one.
     */
    @Test
    fun `starts enrolment for staff without a second factor`() = runTest {
        val transport = ScriptedTransport(
            listOf(
                HttpResponse(200, """{"status":"MFA_SETUP_REQUIRED","setupToken":"setup-token"}"""),
                HttpResponse(200, """{"secret":"JBSWY3DPEHPK3PXP","uri":"otpauth://totp/Klinik"}"""),
            ),
        )
        val (model, _, session) = flow(emptyList(), transport)

        model.submitCredentials("nurse@test.local", "pw")

        val step = model.state.value.step
        assertTrue(step is AuthStep.TwoFactorSetup)
        assertEquals("JBSWY3DPEHPK3PXP", step.secret)
        assertTrue(step.otpauthUri.startsWith("otpauth://"))

        // No session yet: the account is unusable until 2FA exists.
        assertNull(session.currentTokens())

        // Enrolment is reached with the scoped token, not a session token.
        assertEquals("Bearer setup-token", transport.requests[1].headers["Authorization"])
    }

    /**
     * Confirming enrolment does not sign the user in. The backend refuses a
     * TOTP code twice, so the login that follows needs the next code.
     */
    @Test
    fun `enrolment confirmation leads to the code step rather than straight in`() = runTest {
        val (model, _, session) = flow(
            listOf(
                HttpResponse(200, """{"status":"MFA_SETUP_REQUIRED","setupToken":"t"}"""),
                HttpResponse(200, """{"secret":"S","uri":"otpauth://totp/x"}"""),
                HttpResponse(204, ""),
            ),
        )

        model.submitCredentials("nurse@test.local", "pw")
        model.confirmTwoFactorSetup("111111")

        assertEquals(AuthStep.TwoFactorCode, model.state.value.step)
        assertNull(session.currentTokens())
    }

    @Test
    fun `completes the whole staff onboarding sequence`() = runTest {
        val (model, _, session) = flow(
            listOf(
                HttpResponse(200, """{"status":"MFA_SETUP_REQUIRED","setupToken":"t"}"""),
                HttpResponse(200, """{"secret":"S","uri":"otpauth://totp/x"}"""),
                HttpResponse(204, ""),
                HttpResponse(200, success),
            ),
        )

        model.submitCredentials("nurse@test.local", "pw")
        model.confirmTwoFactorSetup("111111")
        model.submitTwoFactorCode("222222")

        assertEquals(AuthStep.SignedIn, model.state.value.step)
        assertEquals("a", session.currentTokens()?.accessToken)
    }

    @Test
    fun `reports wrong credentials without leaving the step`() = runTest {
        val (model, _, _) = flow(
            listOf(HttpResponse(401, """{"statusCode":401,"message":"INVALID_CREDENTIALS"}""")),
        )

        model.submitCredentials("a@b.co", "wrong")

        assertEquals(AuthStep.Credentials, model.state.value.step)
        assertEquals("auth.error.invalidCredentials", model.state.value.errorKey)
        assertTrue(!model.state.value.isLockedOut)
    }

    /** A locked account is not a typo, so the screen says something different. */
    @Test
    fun `flags a locked account separately`() = runTest {
        val (model, _, _) = flow(
            listOf(HttpResponse(401, """{"statusCode":401,"message":"ACCOUNT_LOCKED"}""")),
        )

        model.submitCredentials("a@b.co", "pw")

        assertTrue(model.state.value.isLockedOut)
        assertEquals("auth.error.accountLocked", model.state.value.errorKey)
    }

    @Test
    fun `reports a wrong code without losing the step`() = runTest {
        val (model, _, _) = flow(
            listOf(
                HttpResponse(200, """{"status":"MFA_REQUIRED"}"""),
                HttpResponse(401, """{"statusCode":401,"message":"MFA_INVALID"}"""),
            ),
        )

        model.submitCredentials("a@b.co", "pw")
        model.submitTwoFactorCode("000000")

        // Still on the code step: the user retypes the code, not the password.
        assertEquals(AuthStep.TwoFactorCode, model.state.value.step)
        assertEquals("auth.error.mfaInvalid", model.state.value.errorKey)
    }

    @Test
    fun `shows a message when offline`() = runTest {
        val (model, _, _) = flow(emptyList(), OfflineTransport())

        model.submitCredentials("a@b.co", "pw")

        assertEquals("error.offline", model.state.value.errorKey)
    }

    @Test
    fun `clears an earlier error on the next attempt`() = runTest {
        val (model, _, _) = flow(
            listOf(
                HttpResponse(401, """{"statusCode":401,"message":"INVALID_CREDENTIALS"}"""),
                HttpResponse(200, success),
            ),
        )

        model.submitCredentials("a@b.co", "wrong")
        model.submitCredentials("a@b.co", "right")

        assertNull(model.state.value.errorKey)
        assertEquals(AuthStep.SignedIn, model.state.value.step)
    }

    /**
     * Sending the code before the password step means the flow was restarted;
     * going back beats failing silently.
     */
    @Test
    fun `returns to the start if the code arrives without credentials`() = runTest {
        val transport = ScriptedTransport(listOf(HttpResponse(200, success)))
        val (model, _, _) = flow(emptyList(), transport)

        model.submitTwoFactorCode("123456")

        assertEquals(AuthStep.Credentials, model.state.value.step)
        assertTrue(transport.requests.isEmpty())
    }

    @Test
    fun `reset clears everything`() = runTest {
        val (model, _, _) = flow(listOf(HttpResponse(200, """{"status":"MFA_REQUIRED"}""")))

        model.submitCredentials("a@b.co", "pw")
        model.reset()

        assertEquals(AuthStep.Credentials, model.state.value.step)
        assertNull(model.state.value.errorKey)
    }
}
