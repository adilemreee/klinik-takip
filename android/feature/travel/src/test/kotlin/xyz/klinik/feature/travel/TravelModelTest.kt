package xyz.klinik.feature.travel

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher
import xyz.klinik.network.TravelApi

private object TravelRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading a travel plan must not refresh a session")
}

private class TravelTransport(private val bodies: Map<String, Pair<Int, String>>) : HttpTransport {
    val sent = mutableListOf<Pair<String, String>>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        sent += "${request.method} $path" to request.body.orEmpty()

        val (status, body) = bodies["${request.method} $path"] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private fun view(cleared: String? = null, by: String? = null, version: Int = 2) = """
    {"plan":{"id":"t1","patientId":"p1","arrivalFlight":"TK1980",
      "arrivalAt":"2026-09-20T09:40:00.000Z","departureFlight":null,"departureAt":null,
      "hotelName":"Otel Marmara","hotelAddress":null,"hotelCheckIn":null,"hotelCheckOut":null,
      "greeterName":null,"greeterPhone":null,"transferNote":null,
      "interpreterName":null,"interpreterLanguage":null,"interpreterPhone":null,
      "clearedToFlyAt":${cleared?.let { "\"$it\"" } ?: "null"},"notes":null,"version":$version},
     "clearedToFlyBy":${by?.let { "\"$it\"" } ?: "null"}}
""".trimIndent()

/**
 * Getting the patient here and home again (spec M14).
 *
 * The one thing worth holding to on an otherwise logistical screen: a
 * coordinator editing a hotel address must not be able to carry a medical
 * decision along with it.
 */
class TravelModelTest {
    private fun transport(vararg bodies: Pair<String, Pair<Int, String>>) =
        TravelTransport(bodies.toMap())

    private suspend fun model(transport: TravelTransport, patientId: String? = "p1"): TravelModel {
        val session = SessionManager(InMemoryTokenStore(), TravelRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return TravelModel(
            TravelApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
            patientId = patientId,
        )
    }

    /**
     * Saving the plan never touches the clearance.
     *
     * It is a clinician's decision with a name against it, and the body of a
     * coordinator's form is the wrong place for it to travel.
     */
    @Test
    fun `saving the plan sends no clearance field`() = runTest {
        val transport = transport(
            "GET patients/p1/travel" to (200 to view()),
            "PUT patients/p1/travel" to (200 to view()),
        )
        val subject = model(transport)

        subject.load()
        subject.beginEditing()
        subject.edit { copy(hotelName = "Otel Pera") }
        subject.save()

        val body = transport.sent.last { it.first.startsWith("PUT") }.second

        assertFalse("cleared" in body, body)
        assertTrue("Otel Pera" in body, body)
    }

    /** The version the editor read goes back up with the save. */
    @Test
    fun `the save carries the version that was read`() = runTest {
        val transport = transport(
            "GET patients/p1/travel" to (200 to view(version = 7)),
            "PUT patients/p1/travel" to (200 to view(version = 8)),
        )
        val subject = model(transport)

        subject.load()
        subject.beginEditing()
        subject.save()

        assertTrue(
            "\"expectedVersion\":7" in transport.sent.last { it.first.startsWith("PUT") }.second,
            transport.sent.toString(),
        )
    }

    /**
     * A conflict leaves the form open with what was typed.
     *
     * Somebody else saved first; throwing this entry away would lose the
     * second coordinator's work as well as the first's.
     */
    @Test
    fun `a rejected save keeps the form and what is in it`() = runTest {
        val subject = model(
            transport(
                "GET patients/p1/travel" to (200 to view()),
                "PUT patients/p1/travel" to (409 to """{"message":"conflict"}"""),
            ),
        )

        subject.load()
        subject.beginEditing()
        subject.edit { copy(hotelName = "Otel Pera") }

        assertFalse(subject.save())
        assertTrue(subject.state.value.editing)
        assertEquals("Otel Pera", subject.state.value.draft.hotelName)
        assertNotNull(subject.state.value.error)
    }

    /** The signature goes through its own call. */
    @Test
    fun `clearing to fly is its own request`() = runTest {
        val transport = transport(
            "GET patients/p1/travel" to (200 to view()),
            "PATCH patients/p1/travel/cleared-to-fly" to (
                200 to view(cleared = "2026-09-28T12:00:00.000Z", by = "Dr. Aylin Kaya")
                ),
        )
        val subject = model(transport)

        subject.load()
        assertFalse(subject.state.value.isClearedToFly)

        assertTrue(subject.setClearedToFly(true))

        assertTrue(subject.state.value.isClearedToFly)
        assertEquals("Dr. Aylin Kaya", subject.state.value.clearedBy)
    }

    /**
     * A coordinator without the permission is told, not silently ignored.
     */
    @Test
    fun `a refused clearance says so and changes nothing`() = runTest {
        val subject = model(
            transport(
                "GET patients/p1/travel" to (200 to view()),
                "PATCH patients/p1/travel/cleared-to-fly" to (403 to """{"message":"forbidden"}"""),
            ),
        )

        subject.load()

        assertFalse(subject.setClearedToFly(true))
        assertFalse(subject.state.value.isClearedToFly)
        assertNotNull(subject.state.value.error)
    }

    /** Nothing entered is a state the screen can name, not an error. */
    @Test
    fun `an empty plan is not a failure`() = runTest {
        val subject = model(
            transport(
                "GET patients/p1/travel" to (200 to """{"plan":null,"clearedToFlyBy":null}"""),
            ),
        )

        subject.load()

        assertEquals(TravelPhase.None, subject.state.value.phase)
    }

    /** The patient's own screen reads `me/travel` and cannot write. */
    @Test
    fun `the patient's own plan is read-only`() = runTest {
        val transport = transport("GET me/travel" to (200 to view()))
        val subject = model(transport, patientId = null)

        subject.load()

        assertEquals(TravelPhase.Loaded, subject.state.value.phase)
        assertFalse(subject.save())
        assertFalse(subject.setClearedToFly(true))
        assertTrue(transport.sent.none { it.first.startsWith("PUT") || it.first.startsWith("PATCH") })
    }
}
