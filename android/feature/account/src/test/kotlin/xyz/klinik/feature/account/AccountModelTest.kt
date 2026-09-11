package xyz.klinik.feature.account

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
import xyz.klinik.network.MeApi
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object AccountRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading the account must not refresh a session")
}

private class AccountTransport(private val bodies: Map<String, Pair<Int, String>>) : HttpTransport {
    val sent = mutableListOf<Pair<String, String>>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        sent += "${request.method} $path" to request.body.orEmpty()

        val (status, body) = bodies["${request.method} $path"] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private fun identity(role: String) = """
    {"userId":"u1","role":"$role","displayName":"Ayşe Yılmaz","patientId":"p1",
     "isStaff":${role != "PATIENT" && role != "CAREGIVER"}}
""".trimIndent()

private const val SESSIONS = """
    [{"familyId":"f1","deviceName":"Pixel 9","platform":"android",
      "ipAddress":"203.0.113.9","lastSeenAt":"2026-09-12T07:00:00.000Z","current":true},
     {"familyId":"f2","deviceName":null,"platform":"ios",
      "ipAddress":null,"lastSeenAt":"2026-09-01T07:00:00.000Z","current":false}]
"""

private const val EXPORT = """
    {"exportedAt":"2026-09-12T08:00:00.000Z","format":"klinik-portability-1",
     "patient":{"id":"p1"},"medicalProfile":null,
     "measurements":[{"a":1},{"a":2}],"documents":[],"labResults":[{"b":1}],
     "photos":[],"appointments":[],"medications":[],"complications":[],
     "consents":[],"surveyResponses":[],
     "notIncluded":["Onaylanmamış yapay zekâ yorumları"]}
"""

private val GOOD_PASSWORD = listOf("otel", "4kirmizi", "9lamba").joinToString("")

/**
 * The account somebody signed in with (spec T7.3).
 *
 * Everything here is irreversible in the same way, and the tests are about the
 * guards: a weak password never reaches the server, a second factor cannot be
 * removed without a current code, and staff cannot remove it at all.
 */
class AccountModelTest {
    private fun transport(vararg bodies: Pair<String, Pair<Int, String>>) =
        AccountTransport(bodies.toMap())

    private suspend fun model(transport: AccountTransport): AccountModel {
        val session = SessionManager(InMemoryTokenStore(), AccountRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))
        val client = ApiClient(ApiConfiguration("https://api.test"), transport, session)

        return AccountModel(AuthApi(client), MeApi(client))
    }

    private fun loaded(role: String = "PATIENT") = transport(
        "GET me/identity" to (200 to identity(role)),
        "GET auth/sessions" to (200 to SESSIONS),
        "POST auth/password" to (204 to ""),
        "POST auth/2fa/disable" to (204 to ""),
        "DELETE auth/sessions/f2" to (204 to ""),
        "GET me/data-export" to (200 to EXPORT),
    )

    /** This device is told apart from the others, because one of them is here. */
    @Test
    fun `the current device is separated from the rest`() = runTest {
        val subject = model(loaded())

        subject.load()

        assertEquals("f1", subject.state.value.currentSession?.familyId)
        assertEquals(listOf("f2"), subject.state.value.otherSessions.map { it.familyId })
    }

    /**
     * An account screen that will not open because the session list is
     * unavailable is an account screen nobody can change a password on.
     */
    @Test
    fun `the screen opens even when the session list fails`() = runTest {
        val subject = model(
            transport(
                "GET me/identity" to (200 to identity("PATIENT")),
                "GET auth/sessions" to (500 to "{}"),
            ),
        )

        subject.load()

        assertEquals(AccountPhase.Loaded, subject.state.value.phase)
        assertTrue(subject.state.value.sessions.isEmpty())
    }

    /**
     * A password the rules already refuse never leaves the phone.
     *
     * A rejection arriving from the network on a form filled in twice reads as
     * the app being broken.
     */
    @Test
    fun `a weak password is refused before the request`() = runTest {
        val transport = loaded()
        val subject = model(transport)

        subject.load()

        assertFalse(subject.changePassword("eski", "kisa1"))
        assertTrue(transport.sent.none { it.first.startsWith("POST auth/password") })
    }

    /** Changing a password ends every session, and the screen is told so. */
    @Test
    fun `a changed password reports that every session ended`() = runTest {
        val subject = model(loaded())

        subject.load()

        assertTrue(subject.changePassword("eskiparola123", GOOD_PASSWORD))
        assertEquals(AccountOutcome.PasswordChanged, subject.state.value.outcome)
    }

    /**
     * Clinic staff cannot turn the second factor off.
     *
     * The server refuses it, and a switch that always fails is worse than no
     * switch — so nothing is sent.
     */
    @Test
    fun `staff cannot remove the second factor`() = runTest {
        val transport = loaded(role = "DOCTOR")
        val subject = model(transport)

        subject.load()

        assertFalse(subject.state.value.canDisableTwoFactor)
        assertFalse(subject.disableTwoFactor("123456"))
        assertTrue(transport.sent.none { it.first.contains("2fa/disable") })
    }

    /** A patient's own account is theirs to decide about, with a current code. */
    @Test
    fun `a patient may remove it with a code`() = runTest {
        val transport = loaded()
        val subject = model(transport)

        subject.load()

        assertTrue(subject.state.value.canDisableTwoFactor)
        assertTrue(subject.disableTwoFactor("123456"))
        assertEquals(AccountOutcome.TwoFactorDisabled, subject.state.value.outcome)
        assertTrue(transport.sent.any { it.second.contains("123456") })
    }

    @Test
    fun `ending one session takes that device off the list`() = runTest {
        val subject = model(loaded())

        subject.load()

        assertTrue(subject.endSession("f2"))
        assertEquals(listOf("f1"), subject.state.value.sessions.map { it.familyId })
    }

    /**
     * The export is carried as the server wrote it.
     *
     * The parsed copy is only for the screen's counts; re-encoding a
     * portability file through a client's own model is how a field nobody
     * modelled goes missing from a document meant to be complete.
     */
    @Test
    fun `the export keeps the server's own text and says what is missing`() = runTest {
        val subject = model(loaded())

        subject.load()
        assertTrue(subject.export())

        val outcome = subject.state.value.outcome as? AccountOutcome.Exported

        assertNotNull(outcome)
        assertTrue("klinik-portability-1" in outcome.json)
        assertEquals(3, outcome.export.rowCount)
        assertEquals(
            listOf("Onaylanmamış yapay zekâ yorumları"),
            outcome.export.notIncluded,
        )
    }
}
