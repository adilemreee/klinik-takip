package xyz.klinik.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

private fun photo(reviewSuggested: String = "null", findings: String = "[]") =
    json.decodeFromString<ClinicalPhoto>(
        """
        {"id":"p1","category":"COMPLICATION","bodyArea":"abdomen","phaseLabel":null,
         "mime":"image/jpeg","size":1024,"takenAt":"2026-03-01T08:00:00.000Z",
         "exifStripped":true,"isFaceBlurred":false,"consentId":null,"note":null,
         "aiReviewSuggested":$reviewSuggested,"aiFindings":$findings,
         "aiAssessedAt":"2026-03-01T09:00:00.000Z"}
        """.trimIndent(),
    )

/**
 * The pre-assessment flag, as the clinician's screen sees it (spec M5).
 *
 * Three states, and the difference between two of them is the whole point:
 * nobody has looked, somebody looked and found nothing, and somebody should
 * look.
 */
class PhotoAssessmentTest {
    @Test
    fun `tells apart not looked from looked and clean`() {
        val unassessed = photo(reviewSuggested = "null")
        val clean = photo(reviewSuggested = "false")

        assertFalse(unassessed.needsReview)
        assertFalse(unassessed.isAssessedClean)

        assertFalse(clean.needsReview)
        // Somebody looked and found nothing, which is not the same as nobody
        // having looked.
        assertTrue(clean.isAssessedClean)
    }

    @Test
    fun `marks a photo a clinician should open`() {
        val flagged = photo(reviewSuggested = "true", findings = """["redness","discharge"]""")

        assertTrue(flagged.needsReview)
        assertEquals(listOf("redness", "discharge"), flagged.aiFindings)
    }

    /** The model never writes the words a clinician reads. */
    @Test
    fun `turns the findings into catalogue keys`() {
        val flagged = photo(reviewSuggested = "true", findings = """["redness","wound-open"]""")

        assertEquals(
            listOf("photo_finding_redness", "photo_finding_wound_open"),
            flagged.findingKeys(),
        )
    }

    /** An older server sends none of these fields; that is not a crash. */
    @Test
    fun `tolerates a response without the assessment fields`() {
        val old = json.decodeFromString<ClinicalPhoto>(
            """
            {"id":"p1","category":"COMPLICATION","mime":"image/jpeg","size":1024,
             "takenAt":"2026-03-01T08:00:00.000Z"}
            """.trimIndent(),
        )

        assertNull(old.aiReviewSuggested)
        assertFalse(old.needsReview)
        assertFalse(old.isAssessedClean)
        assertTrue(old.aiFindings.isEmpty())
    }

    @Test
    fun `reads every reason the server can decline for`() {
        for (wire in listOf("disabled", "unsupported-image", "ai-unavailable", "unreadable")) {
            val result = json.decodeFromString<PhotoAssessment>(
                """
                {"photo":{"id":"p1","category":"COMPLICATION","mime":"image/jpeg","size":1,
                          "takenAt":"2026-03-01T08:00:00.000Z"},
                 "findings":[],"reviewSuggested":false,"model":null,"skippedReason":"$wire"}
                """.trimIndent(),
            )

            assertFalse(result.wasAssessed)
            assertFalse(result.reviewSuggested)
        }
    }

    @Test
    fun `knows when an assessment actually happened`() {
        val done = json.decodeFromString<PhotoAssessment>(
            """
            {"photo":{"id":"p1","category":"COMPLICATION","mime":"image/jpeg","size":1,
                      "takenAt":"2026-03-01T08:00:00.000Z"},
             "findings":["redness"],"reviewSuggested":true,"model":"test-vision-2026",
             "skippedReason":null}
            """.trimIndent(),
        )

        assertTrue(done.wasAssessed)
        assertTrue(done.reviewSuggested)
        assertEquals("test-vision-2026", done.model)
    }
}
