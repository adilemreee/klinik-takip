package xyz.klinik.feature.surveys

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
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.SurveyAnswer
import xyz.klinik.network.SurveysApi
import xyz.klinik.network.TokenRefresher

private object SurveyRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Filling in a survey must not refresh a session")
}

private class SurveyTransport(private val bodies: Map<String, Pair<Int, String>>) : HttpTransport {
    val sent = mutableListOf<Pair<String, String>>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/").substringBefore("?")
        sent += "${request.method} $path" to request.body.orEmpty()

        val (status, body) = bodies["${request.method} $path"] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private fun survey(
    id: String,
    scheduledFor: String,
    expiresAt: String?,
    questions: String,
) = """
    {"id":"$id","title":"Ağrı ve iyileşme","description":null,"milestoneDays":7,
     "scheduledFor":"$scheduledFor",
     ${expiresAt?.let { "\"expiresAt\":\"$it\"," } ?: "\"expiresAt\":null,"}
     "questions":[$questions]}
""".trimIndent()

private const val REQUIRED_SCALE = """
    {"id":"pain","text":"Ağrınız ne düzeyde?","type":"SCALE_0_10",
     "direction":"higher-is-worse","alarmAt":8,"required":true}
"""

private const val OPTIONAL_TEXT = """
    {"id":"note","text":"Eklemek istediğiniz bir şey var mı?","type":"TEXT",
     "direction":null,"alarmAt":null,"required":false}
"""

/**
 * The questionnaires a patient fills in after surgery (spec M18).
 *
 * Two things here are not cosmetic: a form is sent whole or not at all, and a
 * form the server would refuse is never offered. Asking somebody for five
 * answers and then rejecting them is worse than not asking.
 */
class SurveyModelTest {
    private fun transport(vararg bodies: Pair<String, Pair<Int, String>>) =
        SurveyTransport(bodies.toMap())

    private suspend fun model(
        transport: SurveyTransport,
        now: String = "2026-09-12T09:00:00.000Z",
    ): SurveyModel {
        val session = SessionManager(InMemoryTokenStore(), SurveyRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return SurveyModel(
            SurveysApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
            now = { now },
        )
    }

    /** The earliest one still open is the one on screen. */
    @Test
    fun `the earliest open survey is the one asked`() = runTest {
        val subject = model(
            transport(
                "GET me/surveys" to (
                    200 to "[" + listOf(
                        survey("late", "2026-09-11T08:00:00.000Z", null, REQUIRED_SCALE),
                        survey("early", "2026-09-10T08:00:00.000Z", null, REQUIRED_SCALE),
                    ).joinToString(",") + "]"
                    ),
            ),
        )

        subject.load()

        assertEquals("early", subject.state.value.current?.id)
    }

    /**
     * An expired form is not offered.
     *
     * The server refuses a late answer, so asking for five answers and then
     * rejecting them is worse than not asking — but it is still listed as
     * missed, because somebody who opens the app a week late should be told,
     * not left wondering whether the app forgot.
     */
    @Test
    fun `an expired survey is shown as missed and not as the current one`() = runTest {
        val subject = model(
            transport(
                "GET me/surveys" to (
                    200 to "[${survey("gone", "2026-09-01T08:00:00.000Z", "2026-09-08T08:00:00.000Z", REQUIRED_SCALE)}]"
                    ),
            ),
        )

        subject.load()

        assertNull(subject.state.value.current)
        assertEquals(listOf("gone"), subject.state.value.missed.map { it.id })
        assertEquals(SurveyPhase.None, subject.state.value.phase)
    }

    /** Nothing waiting is a state, not an error. */
    @Test
    fun `no surveys is not a failure`() = runTest {
        val subject = model(transport("GET me/surveys" to (200 to "[]")))

        subject.load()

        assertEquals(SurveyPhase.None, subject.state.value.phase)
    }

    /** Required questions gate the button; optional ones do not. */
    @Test
    fun `a required question must be answered before the form can be sent`() = runTest {
        val subject = model(
            transport(
                "GET me/surveys" to (
                    200 to "[${survey("s1", "2026-09-10T08:00:00.000Z", null, "$REQUIRED_SCALE,$OPTIONAL_TEXT")}]"
                    ),
            ),
        )

        subject.load()

        assertFalse(subject.state.value.canSubmit)

        subject.answer("note", SurveyAnswer.Text("iyiyim"))
        assertFalse(subject.state.value.canSubmit, "an optional answer is not enough")

        subject.answer("pain", SurveyAnswer.Scale(3))
        assertTrue(subject.state.value.canSubmit)
    }

    /**
     * Sent whole.
     *
     * A form saved question by question leaves half-answered records that read
     * as a patient reporting nothing about the rest, and a pain score of
     * "nothing" is a clinical statement rather than an absence.
     */
    @Test
    fun `the whole form goes in one request`() = runTest {
        val transport = transport(
            "GET me/surveys" to (
                200 to "[${survey("s1", "2026-09-10T08:00:00.000Z", null, "$REQUIRED_SCALE,$OPTIONAL_TEXT")}]"
                ),
            "POST me/surveys/s1" to (200 to """{"invited":false}"""),
        )
        val subject = model(transport)

        subject.load()
        subject.answer("pain", SurveyAnswer.Scale(7))
        subject.answer("note", SurveyAnswer.Text("dün daha iyiydi"))
        subject.submit()

        val posts = transport.sent.filter { it.first.startsWith("POST") }

        assertEquals(1, posts.size)
        assertTrue("\"pain\":7" in posts.single().second, posts.single().second)
        assertTrue("dün daha iyiydi" in posts.single().second, posts.single().second)
        assertTrue(subject.state.value.submitted)
        assertEquals(SurveyPhase.None, subject.state.value.phase)
    }

    /**
     * A failed send keeps the answers.
     *
     * Ten minutes of somebody's attention is not something to throw away
     * because the network dropped; the form stays on screen, filled in, with
     * the reason it did not go.
     */
    @Test
    fun `a failed send keeps what was typed`() = runTest {
        val subject = model(
            transport(
                "GET me/surveys" to (
                    200 to "[${survey("s1", "2026-09-10T08:00:00.000Z", null, REQUIRED_SCALE)}]"
                    ),
                "POST me/surveys/s1" to (500 to "{}"),
            ),
        )

        subject.load()
        subject.answer("pain", SurveyAnswer.Scale(7))
        subject.submit()

        assertEquals(SurveyAnswer.Scale(7), subject.state.value.answers["pain"])
        assertEquals("s1", subject.state.value.current?.id)
        assertFalse(subject.state.value.submitted)
        assertNotNull(subject.state.value.error)
    }

    /** Nothing is sent for a form that is not complete. */
    @Test
    fun `an incomplete form is not sent`() = runTest {
        val transport = transport(
            "GET me/surveys" to (
                200 to "[${survey("s1", "2026-09-10T08:00:00.000Z", null, REQUIRED_SCALE)}]"
                ),
        )
        val subject = model(transport)

        subject.load()
        subject.submit()

        assertTrue(transport.sent.none { it.first.startsWith("POST") })
    }
}
