package xyz.klinik.feature.reports

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.ReportsApi
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object ReviewRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading the queue must not refresh a session")
}

private class ReviewTransport(private val bodies: Map<String, Pair<Int, String>>) : HttpTransport {
    val sent = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/").substringBefore("?")
        sent += "${request.method} $path ${request.body.orEmpty()}"

        val (status, body) = bodies["${request.method} $path"] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private fun report(id: String, risk: String?, generatedAt: String) = """
    {"report":{"id":"$id","patientId":"p1","source":"lab",
      "contentMd":"## Bulgular\nHemogram normal.","patientFacingMd":"Sonuçlarınız normal.",
      ${risk?.let { "\"riskLevel\":\"$it\"," } ?: ""}
      "model":"claude","modelVersion":"1","generatedAt":"$generatedAt",
      "reviewedById":null,"reviewedAt":null,"releasedToPatientAt":null},
     "disclaimer":"Bu metin yapay zeka tarafından üretilmiştir.","visibleToPatient":false}
""".trimIndent()

/**
 * The queue that unblocks everything else (spec M5).
 *
 * Nothing reaches a patient until a clinician signs it off, so the order this
 * list is read in and what happens when a sign-off fails are the whole
 * behaviour worth holding to.
 */
class ReportReviewModelTest {
    private fun transport(vararg bodies: Pair<String, Pair<Int, String>>) =
        ReviewTransport(bodies.toMap())

    private suspend fun model(transport: ReviewTransport): ReportReviewModel {
        val session = SessionManager(InMemoryTokenStore(), ReviewRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return ReportReviewModel(
            ReportsApi(
                ApiClient(ApiConfiguration("https://api.test"), transport, session),
            ),
        )
    }

    /**
     * A critical interpretation from an hour ago outranks a low-risk one from
     * yesterday, and the oldest of equals is the one somebody is still waiting
     * on.
     */
    @Test
    fun `the worst comes first and the oldest of equals next`() = runTest {
        val subject = model(
            transport(
                "GET reports/pending" to (
                    200 to "[" + listOf(
                        report("low", "LOW", "2026-09-10T08:00:00.000Z"),
                        report("critical", "CRITICAL", "2026-09-11T07:00:00.000Z"),
                        report("high-new", "HIGH", "2026-09-11T09:00:00.000Z"),
                        report("high-old", "HIGH", "2026-09-11T06:00:00.000Z"),
                    ).joinToString(",") + "]"
                    ),
            ),
        )

        subject.refresh()

        assertEquals(
            listOf("critical", "high-old", "high-new", "low"),
            subject.state.value.ordered.map { it.report.id },
        )
    }

    /** A report with no risk label sorts with the lowest, not above them. */
    @Test
    fun `an unlabelled report does not jump the queue`() = runTest {
        val subject = model(
            transport(
                "GET reports/pending" to (
                    200 to "[" + listOf(
                        report("none", null, "2026-09-11T06:00:00.000Z"),
                        report("medium", "MEDIUM", "2026-09-11T09:00:00.000Z"),
                    ).joinToString(",") + "]"
                    ),
            ),
        )

        subject.refresh()

        assertEquals(listOf("medium", "none"), subject.state.value.ordered.map { it.report.id })
    }

    /** An empty queue is finished work, not a screen that failed to load. */
    @Test
    fun `nothing waiting is its own state`() = runTest {
        val subject = model(transport("GET reports/pending" to (200 to "[]")))

        subject.refresh()

        assertEquals(ReportReviewPhase.Empty, subject.state.value.phase)
    }

    /**
     * Approving and releasing are one action with two outcomes, and the server
     * is told which.
     */
    @Test
    fun `holding a report says so on the wire`() = runTest {
        val transport = transport(
            "GET reports/pending" to (200 to "[${report("r1", "HIGH", "2026-09-11T06:00:00.000Z")}]"),
            "PATCH reports/r1/review" to (200 to report("r1", "HIGH", "2026-09-11T06:00:00.000Z")),
        )
        val subject = model(transport)

        subject.refresh()
        subject.review("r1", release = false)

        assertTrue(
            transport.sent.any { it.startsWith("PATCH reports/r1/review") && "false" in it },
            transport.sent.toString(),
        )
        assertEquals(ReportReviewPhase.Empty, subject.state.value.phase)
    }

    /**
     * A failed sign-off leaves the report in the list.
     *
     * One that vanished would be a report nobody thinks to look for again, and
     * the patient is still waiting on it.
     */
    @Test
    fun `a failed sign-off keeps the report and says why`() = runTest {
        val subject = model(
            transport(
                "GET reports/pending" to (
                    200 to "[${report("r1", "HIGH", "2026-09-11T06:00:00.000Z")}]"
                    ),
                "PATCH reports/r1/review" to (500 to "{}"),
            ),
        )

        subject.refresh()
        subject.review("r1", release = true)

        assertEquals(listOf("r1"), subject.state.value.reports.map { it.report.id })
        assertEquals(null, subject.state.value.busyId)
        assertNotNull(subject.state.value.actionErrorKey)
    }
}
