package xyz.klinik.feature.surveys

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
import xyz.klinik.network.SurveyFindingKind
import xyz.klinik.network.SurveysApi
import xyz.klinik.network.TokenRefresher

private object TrendRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading a trend must not refresh a session")
}

private class TrendTransport(private val status: Int, private val body: String) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse = HttpResponse(status, body)
}

private const val QUESTIONS = """
    [{"id":"pain","text":"Ağrı","type":"SCALE_0_10","direction":"higher-is-worse",
      "alarmAt":8,"required":true},
     {"id":"note","text":"Not","type":"TEXT","direction":null,"alarmAt":null,
      "required":false}]
"""

private fun point(assignment: String, days: Int, values: String, partial: Boolean = false) = """
    {"assignmentId":"$assignment","milestoneDays":$days,
     "submittedAt":"2026-09-0${days}T08:00:00.000Z","values":$values,
     "answeredCount":1,"questionCount":2,"partial":$partial}
""".trimIndent()

private fun surveys(series: String, findings: String = "[]", hasTrend: Boolean = true) = """
    {"template":{"code":"prom-1","version":1,"title":"Ağrı ve iyileşme",
      "questions":$QUESTIONS},
     "series":[$series],"latestFindings":$findings,"hasTrend":$hasTrend}
""".trimIndent()

/**
 * How a patient's answers have moved (spec M18).
 *
 * The rules worth holding to: a free-text answer is never charted, and one
 * point is never drawn as a direction.
 */
class SurveyTrendModelTest {
    private suspend fun model(body: String, status: Int = 200): SurveyTrendModel {
        val session = SessionManager(InMemoryTokenStore(), TrendRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return SurveyTrendModel(
            SurveysApi(
                ApiClient(ApiConfiguration("https://api.test"), TrendTransport(status, body), session),
            ),
            patientId = "p1",
        )
    }

    /**
     * A free-text answer has no position on an axis, and inventing one would
     * put words where a number belongs.
     */
    @Test
    fun `only numeric questions can be charted`() = runTest {
        val subject = model(surveys(point("a1", 3, """{"pain":4}""")))

        subject.load()

        assertEquals(listOf("pain"), subject.state.value.chartable.map { it.id })
    }

    /** The first numeric question is charted until somebody picks another. */
    @Test
    fun `the first numeric question is the one shown`() = runTest {
        val subject = model(surveys(point("a1", 3, """{"pain":4}""")))

        subject.load()

        assertEquals("pain", subject.state.value.question?.id)
    }

    /** Responses that left the question blank are skipped, not plotted as zero. */
    @Test
    fun `a blank answer is absent rather than zero`() = runTest {
        val subject = model(
            surveys(
                listOf(
                    point("a1", 1, """{"pain":4}"""),
                    point("a2", 3, "{}"),
                    point("a3", 7, """{"pain":6}"""),
                ).joinToString(","),
            ),
        )

        subject.load()

        assertEquals(listOf(4, 6), subject.state.value.points.map { it.second })
    }

    /**
     * One point is not a trend.
     *
     * Drawing a single dot as one invites a clinician to read a direction into
     * it.
     */
    @Test
    fun `a single response is not a trend`() = runTest {
        val subject = model(
            surveys(point("a1", 3, """{"pain":4}"""), hasTrend = false),
        )

        subject.load()

        assertFalse(subject.state.value.hasTrend)
        assertEquals(1, subject.state.value.points.size)
    }

    @Test
    fun `two responses make one`() = runTest {
        val subject = model(
            surveys(
                listOf(
                    point("a1", 1, """{"pain":4}"""),
                    point("a2", 7, """{"pain":8}"""),
                ).joinToString(","),
            ),
        )

        subject.load()

        assertTrue(subject.state.value.hasTrend)
    }

    /**
     * The findings are the server's comparison of this patient against
     * themselves, and are what a clinician came to read.
     */
    @Test
    fun `the latest findings are carried through`() = runTest {
        val subject = model(
            surveys(
                point("a1", 7, """{"pain":9}"""),
                findings = """
                    [{"kind":"severe","questionId":"pain","questionText":"Ağrı",
                      "value":9,"previous":null}]
                """.trimIndent(),
            ),
        )

        subject.load()

        val finding = subject.state.value.findings.single()

        assertEquals(SurveyFindingKind.SEVERE, finding.kind)
        assertEquals("survey.finding.severe", finding.kind.stringKey)
    }

    /** Nothing answered is a real answer about this patient, not a failure. */
    @Test
    fun `a patient who answered nothing is its own state`() = runTest {
        val subject = model(surveys("", hasTrend = false))

        subject.load()

        assertEquals(SurveyTrendPhase.Empty, subject.state.value.phase)
    }

    @Test
    fun `choosing another question moves the chart`() = runTest {
        val subject = model(
            surveys(point("a1", 3, """{"pain":4,"sleep":7}"""))
                .replace(
                    """{"id":"note","text":"Not","type":"TEXT","direction":null,"alarmAt":null,
      "required":false}""",
                    """{"id":"sleep","text":"Uyku","type":"SCALE_0_10",
      "direction":"higher-is-better","alarmAt":null,"required":false}""",
                ),
        )

        subject.load()
        subject.choose("sleep")

        assertEquals("sleep", subject.state.value.question?.id)
        assertEquals(listOf(7), subject.state.value.points.map { it.second })
    }
}
