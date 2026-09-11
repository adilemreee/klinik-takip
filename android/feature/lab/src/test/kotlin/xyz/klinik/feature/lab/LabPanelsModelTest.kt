package xyz.klinik.feature.lab

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
import xyz.klinik.network.LabApi
import xyz.klinik.network.RecordSubject
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object PanelRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading results must not refresh a session")
}

private class PanelTransport(private val bodies: Map<String, Pair<Int, String>>) : HttpTransport {
    val paths = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        paths += path

        val (status, body) = bodies[path.substringBefore("?")] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private fun result(name: String, flag: String?, value: String = "13.4") = """
    {"id":"r-$name","analyteCode":"718-7","analyteName":"$name","value":"$value",
     "unit":"g/dL","refLow":"12.0","refHigh":"16.0",
     "flag":${flag?.let { "\"$it\"" } ?: "null"},
     "measuredAt":"2026-09-10T08:00:00.000Z","ocrConfidence":null,
     "verifiedAt":"2026-09-10T10:00:00.000Z"}
""".trimIndent()

private fun panel(
    measuredAt: String,
    available: Boolean = true,
    results: String = result("Hemoglobin", "NORMAL"),
) = """
    {"measuredAt":"$measuredAt","documentId":"d1","documentName":"Tahlil.pdf",
     "documentAvailable":$available,"results":[$results]}
""".trimIndent()

/**
 * Confirmed results, grouped as the laboratory printed them (spec M16).
 *
 * The rules worth holding to are about what the client must not decide: a
 * result with no printed range is unclassified rather than normal, and a
 * report with no bytes behind it does not get a button that always fails.
 */
class LabPanelsModelTest {
    private suspend fun model(
        transport: PanelTransport,
        subject: RecordSubject = RecordSubject.Patient("p1"),
    ): LabPanelsModel {
        val session = SessionManager(InMemoryTokenStore(), PanelRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return LabPanelsModel(
            LabApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
            subject,
        )
    }

    /** Newest draw first, and open; the rest closed. */
    @Test
    fun `the most recent sheet is the one already open`() = runTest {
        val subject = model(
            PanelTransport(
                mapOf(
                    "patients/p1/lab-results/panels" to (
                        200 to "[${panel("2026-08-01T08:00:00.000Z")},${panel("2026-09-10T08:00:00.000Z")}]"
                        ),
                ),
            ),
        )

        subject.load()

        val panels = subject.state.value.panels

        assertEquals("2026-09-10T08:00:00.000Z", panels.first().measuredAt)
        assertTrue(subject.state.value.isExpanded(panels.first()))
        assertFalse(subject.state.value.isExpanded(panels[1]))
    }

    @Test
    fun `a sheet can be opened and closed`() = runTest {
        val subject = model(
            PanelTransport(
                mapOf(
                    "patients/p1/lab-results/panels" to (
                        200 to "[${panel("2026-09-10T08:00:00.000Z")},${panel("2026-08-01T08:00:00.000Z")}]"
                        ),
                ),
            ),
        )

        subject.load()
        val older = subject.state.value.panels[1]

        subject.toggle(older)
        assertTrue(subject.state.value.isExpanded(older))

        subject.toggle(older)
        assertFalse(subject.state.value.isExpanded(older))
    }

    /**
     * A result with no printed range is unclassified, not normal.
     *
     * Drawing it as normal would be the client deciding something the
     * laboratory did not.
     */
    @Test
    fun `a result with no range is not counted as normal`() = runTest {
        val subject = model(
            PanelTransport(
                mapOf(
                    "patients/p1/lab-results/panels" to (
                        200 to "[${panel("2026-09-10T08:00:00.000Z", results = result("Ferritin", null))}]"
                        ),
                ),
            ),
        )

        subject.load()

        val panel = subject.state.value.panels.single()

        assertEquals(1, panel.unclassified.size)
        assertFalse(panel.hasAbnormal)
    }

    @Test
    fun `an out-of-range value is marked on the sheet`() = runTest {
        val subject = model(
            PanelTransport(
                mapOf(
                    "patients/p1/lab-results/panels" to (
                        200 to "[${panel("2026-09-10T08:00:00.000Z", results = result("CRP", "CRITICAL"))}]"
                        ),
                ),
            ),
        )

        subject.load()

        assertTrue(subject.state.value.panels.single().hasCritical)
    }

    /** Nothing confirmed is not nothing uploaded, and reads differently. */
    @Test
    fun `no confirmed results is its own state`() = runTest {
        val subject = model(
            PanelTransport(mapOf("patients/p1/lab-results/panels" to (200 to "[]"))),
        )

        subject.load()

        assertEquals(LabPanelsPhase.Empty, subject.state.value.phase)
    }

    /** A patient reads their own panels through `me/…`. */
    @Test
    fun `the patient's own panels come from the me path`() = runTest {
        val transport = PanelTransport(
            mapOf("me/lab-results/panels" to (200 to "[${panel("2026-09-10T08:00:00.000Z")}]")),
        )
        val subject = model(transport, RecordSubject.Me)

        subject.load()

        assertEquals(listOf("me/lab-results/panels"), transport.paths)
    }

    /** A report with no bytes behind it says so, so no button is drawn. */
    @Test
    fun `a report with nothing behind it is marked unavailable`() = runTest {
        val subject = model(
            PanelTransport(
                mapOf(
                    "patients/p1/lab-results/panels" to (
                        200 to "[${panel("2026-09-10T08:00:00.000Z", available = false)}]"
                        ),
                ),
            ),
        )

        subject.load()

        assertFalse(subject.state.value.panels.single().documentAvailable)
    }
}
