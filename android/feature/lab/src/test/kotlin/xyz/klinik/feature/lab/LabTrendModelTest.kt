package xyz.klinik.feature.lab

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.RecordSubject
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ApiError
import xyz.klinik.network.ErrorResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.LabApi
import xyz.klinik.network.LabFlag
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens

class LabTrendModelTest {
    private fun trend(
        name: String,
        unit: String = "g/dL",
        code: String = "718-7",
        reference: String = """{"low":12,"high":16}""",
    ) = """
        {"analyteCode":"$code","analyteName":"$name","unit":"$unit",
         "points":[
           {"measuredAt":"2026-01-02T08:00:00.000Z","value":13.5,"flag":"NORMAL","refLow":12,"refHigh":16},
           {"measuredAt":"2026-02-02T08:00:00.000Z","value":14.1,"flag":"NORMAL","refLow":12,"refHigh":16}
         ],
         "reference":$reference,"latestFlag":"NORMAL"}
    """.trimIndent()

    private val criticalResult = """
        [{"id":"r9","analyteCode":"718-7","analyteName":"Hemoglobin","value":"4",
          "unit":"g/dL","refLow":"12","refHigh":"16","flag":"CRITICAL",
          "measuredAt":"2026-03-01T08:00:00.000Z","ocrConfidence":"0.9",
          "verifiedAt":"2026-03-01T09:00:00.000Z"}]
    """.trimIndent()

    private suspend fun model(transport: HttpTransport): LabTrendModel {
        val session = SessionManager(InMemoryTokenStore(), UnusedRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))
        return LabTrendModel(
            LabApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
            RecordSubject.Patient("p1"),
        )
    }

    @Test
    fun `loads trends and selects the first`() = runTest {
        val model = model(
            PathTransport(
                mapOf(
                    "patients/p1/lab-results/trends" to (200 to "[${trend("Hemoglobin")}]"),
                    "patients/p1/lab-results/critical" to (200 to "[]"),
                ),
            ),
        )

        model.load()

        val state = model.state.value

        assertEquals(LabTrendPhase.Loaded, state.phase)
        assertEquals("Hemoglobin", state.selectedTrend?.analyteName)
        assertEquals(2, state.selectedTrend?.points?.size)
    }

    @Test
    fun `carries the reference band`() = runTest {
        val model = model(
            PathTransport(
                mapOf(
                    "patients/p1/lab-results/trends" to (200 to "[${trend("Hemoglobin")}]"),
                    "patients/p1/lab-results/critical" to (200 to "[]"),
                ),
            ),
        )

        model.load()

        assertEquals(12.0, model.state.value.selectedTrend?.reference?.low)
        assertEquals(16.0, model.state.value.selectedTrend?.reference?.high)
    }

    /**
     * No band is a real answer, not a missing field: the points were measured
     * against different ranges, and one band across them would put results on
     * the wrong side of a line they were never compared to.
     */
    @Test
    fun `accepts a trend with no band`() = runTest {
        val model = model(
            PathTransport(
                mapOf(
                    "patients/p1/lab-results/trends" to
                        (200 to "[${trend("Hemoglobin", reference = "null")}]"),
                    "patients/p1/lab-results/critical" to (200 to "[]"),
                ),
            ),
        )

        model.load()

        assertEquals(LabTrendPhase.Loaded, model.state.value.phase)
        assertNull(model.state.value.selectedTrend?.reference)
        // The per-point ranges survive, so the screen can still say something.
        assertEquals(12.0, model.state.value.selectedTrend?.points?.first()?.refLow)
    }

    /** The same analyte in two units is two series, never one axis. */
    @Test
    fun `keeps two units apart`() = runTest {
        val model = model(
            PathTransport(
                mapOf(
                    "patients/p1/lab-results/trends" to (
                        200 to
                            "[${trend("Glukoz", unit = "mg/dL")},${trend("Glukoz", unit = "mmol/L")}]"
                        ),
                    "patients/p1/lab-results/critical" to (200 to "[]"),
                ),
            ),
        )

        model.load()

        assertEquals(2, model.state.value.trends.size)
        assertNotEquals(model.state.value.trends[0].id, model.state.value.trends[1].id)
    }

    /** A critical value must not depend on which chart the doctor opened. */
    @Test
    fun `loads critical values alongside the charts`() = runTest {
        val model = model(
            PathTransport(
                mapOf(
                    "patients/p1/lab-results/trends" to (200 to "[${trend("Hemoglobin")}]"),
                    "patients/p1/lab-results/critical" to (200 to criticalResult),
                ),
            ),
        )

        model.load()

        assertEquals(1, model.state.value.critical.size)
        assertEquals(LabFlag.CRITICAL, model.state.value.critical[0].flag)
    }

    /** Nothing confirmed yet is not a failure — results exist only after review. */
    @Test
    fun `reports empty separately from failure`() = runTest {
        val model = model(
            PathTransport(
                mapOf(
                    "patients/p1/lab-results/trends" to (200 to "[]"),
                    "patients/p1/lab-results/critical" to (200 to "[]"),
                ),
            ),
        )

        model.load()

        assertEquals(LabTrendPhase.Empty, model.state.value.phase)
    }

    @Test
    fun `treats not found as its own state`() = runTest {
        val model = model(FailingTransport(ApiError.NotFound(ErrorResponse(statusCode = 404))))

        model.load()

        assertEquals(LabTrendPhase.NotFound, model.state.value.phase)
    }

    @Test
    fun `switches the selected analyte`() = runTest {
        val model = model(
            PathTransport(
                mapOf(
                    "patients/p1/lab-results/trends" to (
                        200 to
                            "[${trend("Glukoz", code = "2345-7")},${trend("Kreatinin", code = "2160-0")}]"
                        ),
                    "patients/p1/lab-results/critical" to (200 to "[]"),
                ),
            ),
        )

        model.load()
        model.select(model.state.value.trends[1].id)

        assertEquals("Kreatinin", model.state.value.selectedTrend?.analyteName)
    }
}
