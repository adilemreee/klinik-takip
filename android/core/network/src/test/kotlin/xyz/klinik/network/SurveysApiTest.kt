package xyz.klinik.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

/**
 * Patient-reported outcome questionnaires (spec M18, T6.7).
 *
 * The patient's screen and the clinician's read the same data and must not say
 * the same things about it, so the two views are tested separately.
 */
class SurveysApiTest {
    private val now = "2026-03-15T09:00:00.000Z"

    @Test
    fun `reads a questionnaire with its questions`() {
        val pending = json.decodeFromString<List<PendingSurvey>>(
            """
            [{"id":"a1","title":"Kısa değerlendirme","milestoneDays":7,
              "scheduledFor":"2026-03-09T08:00:00.000Z","expiresAt":"2026-03-23T08:00:00.000Z",
              "questions":[
                {"id":"pain","text":"Ağrı","type":"SCALE_0_10","direction":"higher-is-worse",
                 "alarmAt":8,"required":true},
                {"id":"comment","text":"Not","type":"TEXT"}]}]
            """.trimIndent(),
        )

        assertEquals(2, pending[0].questions.size)
        assertEquals(SurveyDirection.HIGHER_IS_WORSE, pending[0].questions[0].direction)
        assertEquals(listOf("pain"), pending[0].requiredQuestions.map { it.id })
        assertNull(pending[0].questions[1].direction)
    }

    /** Inviting somebody to fill in a form the server will reject is worse than not asking. */
    @Test
    fun `knows when a questionnaire has closed`() {
        val open = json.decodeFromString<PendingSurvey>(
            """{"id":"a1","title":"T","milestoneDays":7,"scheduledFor":"$now",
                "expiresAt":"2026-03-23T08:00:00.000Z"}""",
        )
        val closed = json.decodeFromString<PendingSurvey>(
            """{"id":"a2","title":"T","milestoneDays":7,"scheduledFor":"$now",
                "expiresAt":"2026-03-01T08:00:00.000Z"}""",
        )

        assertTrue(open.isOpen(now))
        assertFalse(closed.isOpen(now))
    }

    @Test
    fun `an answer encodes in the shape its question expects`() {
        assertEquals("4", SurveyAnswer.Scale(4).toJson().toString())
        assertEquals("true", SurveyAnswer.YesNo(true).toJson().toString())
        assertEquals("\"iyiyim\"", SurveyAnswer.Text("iyiyim").toJson().toString())
    }

    /** The patient is told it was recorded, and nothing about what it means. */
    @Test
    fun `the answer comes back with no clinical reading`() {
        val result = json.decodeFromString<SurveySubmitResult>("""{"invited":true}""")

        assertTrue(result.invited)
    }

    @Test
    fun `draws no trend through a single point`() {
        val view = json.decodeFromString<PatientSurveys>(
            """
            {"template":{"code":"postop","version":1,"title":"T"},
             "series":[{"assignmentId":"a1","milestoneDays":7,"submittedAt":"$now",
                        "values":{"pain":5},"answeredCount":5,"questionCount":5,"partial":false}],
             "hasTrend":false}
            """.trimIndent(),
        )

        assertFalse(view.hasTrend)
        assertEquals(1, view.series.size)
        assertFalse(view.needsAttention)
    }

    @Test
    fun `marks a partial response so it is not read as a full one`() {
        val view = json.decodeFromString<PatientSurveys>(
            """
            {"template":{"code":"postop","version":1,"title":"T"},
             "series":[{"assignmentId":"a1","milestoneDays":7,"submittedAt":"$now",
                        "values":{"pain":2},"answeredCount":1,"questionCount":5,"partial":true},
                       {"assignmentId":"a2","milestoneDays":30,"submittedAt":"$now",
                        "values":{"pain":3,"sleep":8},"answeredCount":5,"questionCount":5,
                        "partial":false}],
             "hasTrend":true}
            """.trimIndent(),
        )

        assertTrue(view.series[0].partial)
        assertFalse(view.series[1].partial)
        // A gap, not a nought: the chart must not drop a point to the floor
        // because somebody skipped a question.
        assertEquals(listOf(2, 3), view.points("pain").map { it.second })
        assertEquals(listOf(8), view.points("sleep").map { it.second })
        assertTrue(view.points("swelling").isEmpty())
    }

    @Test
    fun `reads findings with their reason`() {
        val view = json.decodeFromString<PatientSurveys>(
            """
            {"template":{"code":"postop","version":1,"title":"T"},
             "latestFindings":[
               {"kind":"worsened","questionId":"pain","questionText":"Ağrı","value":7,"previous":2},
               {"kind":"severe","questionId":"sleep","questionText":"Uyku","value":1}],
             "hasTrend":true}
            """.trimIndent(),
        )

        assertTrue(view.needsAttention)
        assertEquals(2, view.latestFindings[0].previous)
        // A severe finding stands on its own, with nothing to compare against.
        assertNull(view.latestFindings[1].previous)
        assertEquals("survey_finding_worsened", view.latestFindings[0].kind.stringKey)
    }

    @Test
    fun `knows which questions a chart can plot`() {
        val questions = json.decodeFromString<List<SurveyQuestion>>(
            """
            [{"id":"pain","text":"A","type":"SCALE_0_10","direction":"higher-is-worse"},
             {"id":"slept","text":"B","type":"YES_NO"},
             {"id":"comment","text":"C","type":"TEXT"}]
            """.trimIndent(),
        )

        assertEquals(listOf("pain", "slept"), questions.filter { it.isNumeric }.map { it.id })
    }
}
