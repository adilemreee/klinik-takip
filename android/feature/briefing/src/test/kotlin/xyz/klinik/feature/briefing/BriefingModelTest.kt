package xyz.klinik.feature.briefing

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.BriefingApi
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.RiskKind
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object BriefingRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading the briefing must not refresh a session")
}

private class BriefingTransport(
    private val status: Int,
    private val body: String,
) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse = HttpResponse(status, body)
}

private fun risk(kind: String, waiting: Int) = """
    {"patientId":"p-$kind","patientName":"Ayşe Yılmaz","kind":"$kind",
     "detail":"detay","waitingMinutes":$waiting}
""".trimIndent()

private fun briefing(atRisk: String, quiet: Boolean = false) = """
    {"facts":{"generatedAt":"2026-09-11T05:00:00.000Z",
      "yesterday":{"newMessages":7,"urgentMessages":2,"emergencies":1,
                   "complications":0,"criticalLabs":3},
      "today":{"appointments":5,"followUps":2},
      "atRisk":[$atRisk]},
     "narrative":"Bir acil çağrı bekliyor.","quiet":$quiet}
""".trimIndent()

/**
 * The clinician's morning (spec M5).
 *
 * The order is the whole value of the list — it is read from the top and
 * abandoned when the phone rings — and "quiet" has to be a state the screen
 * can name, because a blank page reads as an app that failed rather than a
 * morning with nothing waiting.
 */
class BriefingModelTest {
    private suspend fun model(body: String, status: Int = 200): BriefingModel {
        val session = SessionManager(InMemoryTokenStore(), BriefingRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return BriefingModel(
            BriefingApi(
                ApiClient(
                    ApiConfiguration("https://api.test"),
                    BriefingTransport(status, body),
                    session,
                ),
            ),
        )
    }

    /**
     * An unanswered emergency outranks everything.
     *
     * Somebody is waiting for help; an unreviewed report is paperwork. The
     * server sends them in its own order and the client does not reshuffle the
     * rest — only this one is lifted.
     */
    @Test
    fun `an unanswered emergency comes first`() = runTest {
        val subject = model(
            briefing(
                listOf(
                    risk("report-unreviewed", 400),
                    risk("emergency-unanswered", 5),
                    risk("message-urgent", 90),
                ).joinToString(","),
            ),
        )

        subject.refresh()

        assertEquals(
            listOf(RiskKind.EMERGENCY_UNANSWERED, RiskKind.MESSAGE_URGENT, RiskKind.REPORT_UNREVIEWED),
            subject.state.value.atRisk.map { it.kind },
        )
    }

    /**
     * Nothing waiting is an answer, and a different one from an empty screen.
     */
    @Test
    fun `a quiet morning is its own state`() = runTest {
        val subject = model(briefing(atRisk = "", quiet = true))

        subject.refresh()

        assertEquals(BriefingPhase.Quiet, subject.state.value.phase)
    }

    /**
     * The screen is drawn from the facts, so a briefing with no paragraph is
     * still a briefing — otherwise a switched-off AI layer looks like an empty
     * morning.
     */
    @Test
    fun `the facts carry the screen without a paragraph`() = runTest {
        val subject = model(
            briefing(risk("message-urgent", 30)).replace(
                "\"narrative\":\"Bir acil çağrı bekliyor.\"",
                "\"narrative\":null",
            ),
        )

        subject.refresh()

        assertEquals(BriefingPhase.Loaded, subject.state.value.phase)
        assertEquals(null, subject.state.value.narrative)
        assertEquals(7, subject.state.value.briefing?.facts?.yesterday?.newMessages)
    }

    /**
     * A failure says so and offers a way back, rather than leaving the
     * spinner turning on the screen the app opens onto.
     */
    @Test
    fun `a failure becomes a message the screen can show`() = runTest {
        val subject = model(status = 500, body = "{}")

        subject.refresh()

        val phase = subject.state.value.phase

        assertTrue(phase is BriefingPhase.Failed, "expected Failed, was $phase")
        assertTrue(phase.messageKey.startsWith("error."), phase.messageKey)
    }
}
