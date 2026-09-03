package xyz.klinik.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

private fun medication(
    approvedAt: String = "\"2026-03-01T08:00:00.000Z\"",
    stoppedAt: String = "null",
    source: String = "PRESCRIBED",
) = """
    {"id":"m1","patientId":"p1","drugName":"Amoksisilin","dose":"500 mg","form":"tablet",
     "frequencyRule":"FREQ=DAILY;COUNT=16;BYHOUR=9,21","timezone":"Europe/Berlin",
     "startDate":"2026-03-02T00:00:00.000Z","endDate":null,"instructions":null,
     "source":"$source","approvedAt":$approvedAt,"stoppedAt":$stoppedAt}
""".trimIndent()

private fun view(adherence: String, badges: String = "[]") = """
    {"medication":${medication()},"schedule":"günde 2, 16 doz",
     "adherence":$adherence,"badges":$badges,"nextDose":"2026-03-02T20:00:00.000Z"}
""".trimIndent()

/**
 * Medication as the patient's screen sees it (spec M9).
 *
 * The property that matters on the client: a course with nothing due yet has no
 * score, and rendering that as nought per cent would tell a patient on their
 * first morning that they are failing.
 */
class MedicationsApiTest {
    @Test
    fun `has no score before any dose has come due`() {
        val parsed = json.decodeFromString<MedicationView>(
            view("""{"score":null,"taken":0,"missed":0,"due":0,"upcoming":16,"streak":0}"""),
        )

        assertFalse(parsed.adherence.hasScore)
        assertNull(parsed.adherence.percentage)
    }

    @Test
    fun `reports the score as a whole percentage once there is one`() {
        val parsed = json.decodeFromString<MedicationView>(
            view("""{"score":0.8333,"taken":5,"missed":1,"due":6,"upcoming":10,"streak":2}"""),
        )

        assertTrue(parsed.adherence.hasScore)
        assertEquals(83, parsed.adherence.percentage)
        assertEquals(2, parsed.adherence.streak)
    }

    /** Inert until a clinician approves it: no schedule, nothing counted. */
    @Test
    fun `tells apart a prescribed course from one waiting for approval`() {
        val prescribed = json.decodeFromString<Medication>(medication())
        val waiting = json.decodeFromString<Medication>(
            medication(approvedAt = "null", source = "PATIENT_REPORTED"),
        )

        assertTrue(prescribed.isActive)
        assertFalse(prescribed.awaitingApproval)

        assertFalse(waiting.isActive)
        assertTrue(waiting.awaitingApproval)
        assertEquals(MedicationSource.PATIENT_REPORTED, waiting.source)
    }

    @Test
    fun `knows a stopped course is no longer active`() {
        val stopped = json.decodeFromString<Medication>(
            medication(stoppedAt = "\"2026-03-05T08:00:00.000Z\""),
        )

        assertFalse(stopped.isActive)
        assertFalse(stopped.awaitingApproval)
    }

    /** A late dose is taken. The patient is not shown it as a miss. */
    @Test
    fun `separates the doses still waiting from the ones answered`() {
        val mine = json.decodeFromString<MyMedications>(
            """
            {"medications":[],"today":[
              {"id":"d1","medicationId":"m1","scheduledAt":"2026-03-02T06:00:00.000Z","status":"TAKEN"},
              {"id":"d2","medicationId":"m1","scheduledAt":"2026-03-02T18:00:00.000Z","status":"PENDING"},
              {"id":"d3","medicationId":"m1","scheduledAt":"2026-03-02T20:00:00.000Z","status":"SNOOZED"},
              {"id":"d4","medicationId":"m1","scheduledAt":"2026-03-02T22:00:00.000Z","status":"LATE"}],
             "overall":{"score":1.0,"taken":2,"missed":0,"due":2,"upcoming":2,"streak":1},
             "badges":["first-dose"]}
            """.trimIndent(),
        )

        assertEquals(listOf("d2", "d3"), mine.openToday.map { it.id })
        assertFalse(DoseStatus.LATE.isOpen)
        assertTrue(DoseStatus.SNOOZED.isOpen)
    }

    @Test
    fun `turns the badges into catalogue keys`() {
        val mine = json.decodeFromString<MyMedications>(
            """
            {"medications":[],"today":[],
             "overall":{"score":1.0,"taken":9,"missed":0,"due":9,"upcoming":0,"streak":7},
             "badges":["first-dose","three-days","one-week"]}
            """.trimIndent(),
        )

        assertEquals(
            listOf("medication_badge_first_dose", "medication_badge_three_days", "medication_badge_one_week"),
            mine.badgeKeys(),
        )
    }

    /**
     * The tone rule from M9: no badges over a list of missed doses. The server
     * withholds them, and the client shows what it is given.
     */
    @Test
    fun `shows no badges when the server withheld them`() {
        val mine = json.decodeFromString<MyMedications>(
            """
            {"medications":[],"today":[],
             "overall":{"score":0.2,"taken":2,"missed":8,"due":10,"upcoming":0,"streak":0},
             "badges":[]}
            """.trimIndent(),
        )

        assertTrue(mine.badges.isEmpty())
        assertEquals(20, mine.overall.percentage)
    }

    @Test
    fun `has a string key for every dose status`() {
        for (status in DoseStatus.entries) {
            assertTrue(status.stringKey.startsWith("medication_status_"))
        }
    }
}
