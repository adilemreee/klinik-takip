package xyz.klinik.feature.patients

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.PatientsApi
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object NewPatientRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Opening a file must not refresh a session")
}

private class NewPatientTransport(private val status: Int, private val body: String) :
    HttpTransport {
    val sent = mutableListOf<Pair<String, String>>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        sent += "${request.method} ${request.url.substringAfter("https://api.test/")}" to
            request.body.orEmpty()

        return HttpResponse(status, body)
    }
}

private const val CREATED = """
    {"id":"p9","mrn":"2026-K7RMPX","firstName":"Ayşe","lastName":"Yılmaz",
     "birthDate":"1984-03-21","sex":"FEMALE","country":"DE","city":"Köln",
     "preferredLanguage":"tr","status":"LEAD","createdAt":"2026-09-12T08:00:00.000Z"}
"""

/**
 * Opening a file (spec M2).
 *
 * The form refuses what the server would refuse, while somebody types — and
 * keeps what was typed when the network does not, because retyping a name and
 * a date of birth is how records get entered twice.
 */
class NewPatientModelTest {
    private suspend fun model(
        transport: NewPatientTransport = NewPatientTransport(201, CREATED),
    ): Pair<NewPatientModel, NewPatientTransport> {
        val session = SessionManager(InMemoryTokenStore(), NewPatientRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        val model = NewPatientModel(
            PatientsApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
        )

        return model to transport
    }

    private fun NewPatientModel.fillIn() {
        edit {
            copy(
                firstName = "Ayşe",
                lastName = "Yılmaz",
                birthDate = "1984-03-21",
                country = "de",
            )
        }
    }

    @Test
    fun `a complete form can be sent`() = runTest {
        val (subject, _) = model()

        subject.fillIn()

        assertTrue(subject.state.value.canSubmit)
        assertEquals(emptyList(), subject.state.value.problems)
    }

    @Test
    fun `a missing name is named before the request`() = runTest {
        val (subject, transport) = model()

        subject.edit { copy(birthDate = "1984-03-21", country = "DE") }

        assertTrue(NewPatientProblem.NoName in subject.state.value.problems)
        assertNull(subject.create())
        assertTrue(transport.sent.isEmpty())
    }

    /**
     * Two letters, because the server takes ISO 3166-1 alpha-2 and refuses
     * anything else — after the form has been filled in.
     */
    @Test
    fun `a country that is not two letters is refused here`() = runTest {
        val (subject, _) = model()

        subject.fillIn()
        subject.edit { copy(country = "Almanya") }

        assertTrue(NewPatientProblem.BadCountry in subject.state.value.problems)
        assertFalse(subject.state.value.canSubmit)
    }

    /** The code is sent as the server wants it, whatever case it was typed in. */
    @Test
    fun `the country goes up in upper case`() = runTest {
        val (subject, transport) = model()

        subject.fillIn()
        subject.create()

        assertTrue("\"country\":\"DE\"" in transport.sent.single().second, transport.sent.toString())
    }

    /** A blank optional field is absent, not an empty string on the record. */
    @Test
    fun `an empty city is not sent`() = runTest {
        val (subject, transport) = model()

        subject.fillIn()
        subject.create()

        val body = transport.sent.single().second

        assertTrue("\"city\":null" in body || "city" !in body, body)
    }

    @Test
    fun `the created file carries the number the server assigned`() = runTest {
        val (subject, _) = model()

        subject.fillIn()
        val patient = subject.create()

        assertNotNull(patient)
        assertEquals("2026-K7RMPX", patient.mrn)
        assertEquals("2026-K7RMPX", subject.state.value.created?.mrn)
    }

    /**
     * A failed send keeps the form.
     *
     * Retyping a name and a date of birth because the network dropped is how
     * the same patient ends up in the system twice.
     */
    @Test
    fun `a failed request keeps what was typed`() = runTest {
        val (subject, _) = model(NewPatientTransport(500, "{}"))

        subject.fillIn()

        assertNull(subject.create())
        assertEquals("Ayşe", subject.state.value.draft.firstName)
        assertNotNull(subject.state.value.error)
    }
}
