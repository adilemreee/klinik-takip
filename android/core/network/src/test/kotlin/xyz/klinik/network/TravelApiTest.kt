package xyz.klinik.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

/**
 * Getting the patient here and home again (spec M14).
 *
 * One field on this otherwise logistical record is clinical, and the rest of
 * the tests are about not confusing the two.
 */
class TravelApiTest {
    private val full = """
        {"id":"t1","patientId":"p1","arrivalFlight":"TK1980",
         "arrivalAt":"2026-09-20T09:40:00.000Z","departureFlight":"TK1981",
         "departureAt":"2026-10-01T18:00:00.000Z","hotelName":"Otel Marmara",
         "hotelAddress":"Taksim","hotelCheckIn":"2026-09-20","hotelCheckOut":"2026-10-01",
         "greeterName":"Selim","greeterPhone":"+905550000000","transferNote":null,
         "interpreterName":"Anna","interpreterLanguage":"de","interpreterPhone":null,
         "clearedToFlyAt":"2026-09-28T12:00:00.000Z","notes":null,"version":3}
    """.trimIndent()

    /**
     * Cleared to fly is a signature, not a date arithmetic.
     *
     * The server sets it when a clinician says so and never computes it from
     * the surgery date, and the client must not either — "seven days after an
     * operation" is a rule of thumb; this is a decision with a name on it.
     */
    @Test
    fun `cleared to fly is whatever a clinician recorded`() {
        val view = json.decodeFromString<TravelPlanView>(
            """{"plan":$full,"clearedToFlyBy":"Dr. Aylin Kaya"}""",
        )

        assertTrue(view.plan?.isClearedToFly == true)
        assertEquals("Dr. Aylin Kaya", view.clearedToFlyBy)
    }

    @Test
    fun `nobody signed off is nobody, not a default`() {
        val view = json.decodeFromString<TravelPlanView>(
            """{"plan":${full.replace("\"clearedToFlyAt\":\"2026-09-28T12:00:00.000Z\"", "\"clearedToFlyAt\":null")},"clearedToFlyBy":null}""",
        )

        assertFalse(view.plan?.isClearedToFly == true)
        assertNull(view.clearedToFlyBy)
    }

    /** A patient with no plan yet is not a patient with an error. */
    @Test
    fun `no plan is a real answer`() {
        val view = json.decodeFromString<TravelPlanView>("""{"plan":null,"clearedToFlyBy":null}""")

        assertNull(view.plan)
    }

    /** An untouched plan reads as empty rather than as a row of blanks. */
    @Test
    fun `a plan nobody filled in knows it is empty`() {
        val plan = json.decodeFromString<TravelPlan>(
            """{"id":"t2","patientId":"p2","version":0}""",
        )

        assertTrue(plan.isEmpty)
    }

    @Test
    fun `a plan with a flight is not empty`() {
        val plan = json.decodeFromString<TravelPlan>(full)

        assertFalse(plan.isEmpty)
        assertEquals(3, plan.version)
    }

    /**
     * The version goes back up with the save.
     *
     * Two coordinators arranging one patient's travel is the ordinary case
     * here, and a second save winning silently would lose the first's flight
     * number.
     */
    @Test
    fun `a save carries the version the editor read`() {
        val body = Json.encodeToString(
            UpsertTravelPlan.serializer(),
            UpsertTravelPlan(arrivalFlight = "TK1980", expectedVersion = 3),
        )

        assertTrue("\"expectedVersion\":3" in body, body)
    }
}
