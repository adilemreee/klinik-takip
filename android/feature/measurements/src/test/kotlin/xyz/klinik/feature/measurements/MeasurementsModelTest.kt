package xyz.klinik.feature.measurements

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ApiError
import xyz.klinik.network.BmiCategory
import xyz.klinik.network.ErrorResponse
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.MeasurementSubject
import xyz.klinik.network.MeasurementType
import xyz.klinik.network.MeasurementsApi
import xyz.klinik.network.NewMeasurement
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher
import xyz.klinik.network.UiText

/** Replies by path, and remembers every request so a test can inspect both. */
private class RecordingTransport(
    private val bodies: Map<String, Pair<Int, String>>,
    /**
     * Per-path delay on the test scheduler's virtual clock, so a test can hold
     * one request open while another arrives — which is the only way a second
     * tap is actually concurrent with the first.
     */
    private val delays: Map<String, Long> = emptyMap(),
) : HttpTransport {
    val paths = mutableListOf<String>()
    val sentBodies = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/").substringBefore("?")
        paths += path
        request.body?.let { sentBodies += it }

        delays[path]?.let { delay(it) }

        val (status, body) = bodies[path] ?: (500 to "{}")
        return HttpResponse(status, body)
    }
}

private class FailingTransport(private val error: ApiError) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse = throw error
}

private object UnusedRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("The chart must not refresh")
}

class MeasurementsModelTest {
    private val chartJson = """
        {
          "weight": [
            {"measuredAt":"2026-01-02T08:00:00.000Z","value":66.2,"secondaryValue":null,"unit":"kg","source":"NURSE"}
          ],
          "bmi": [
            {"measuredAt":"2026-01-02T08:00:00.000Z","bmi":22.9,"category":"NORMAL","weightKg":66.2,"heightCm":170}
          ],
          "targetWeightKg": 65,
          "targetBmi": 22.5
        }
    """.trimIndent()

    private val emptyChartJson = """{"weight":[],"bmi":[],"targetWeightKg":null,"targetBmi":null}"""

    private suspend fun model(
        transport: HttpTransport,
        subject: MeasurementSubject = MeasurementSubject.OfPatient("p1"),
    ): MeasurementsModel {
        val session = SessionManager(InMemoryTokenStore(), UnusedRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))
        val client = ApiClient(ApiConfiguration("https://api.test"), transport, session)
        return MeasurementsModel(MeasurementsApi(client), subject)
    }

    @Test
    fun `loads the chart`() = runTest {
        val measurements = model(
            RecordingTransport(mapOf("patients/p1/measurements/chart" to (200 to chartJson))),
        )

        measurements.load()

        val phase = measurements.state.value.phase as ChartPhase.Loaded

        assertEquals(66.2, phase.chart.weight.first().value)
        assertEquals(BmiCategory.NORMAL, phase.chart.bmi.first().category)
        assertEquals(65.0, phase.chart.targetWeightKg)
        assertEquals(22.5, phase.chart.targetBmi)
    }

    /** Nothing recorded yet is not a failure, and must not be shown as one. */
    @Test
    fun `reports empty separately from failure`() = runTest {
        val measurements = model(
            RecordingTransport(mapOf("patients/p1/measurements/chart" to (200 to emptyChartJson))),
        )

        measurements.load()

        assertEquals(ChartPhase.Empty, measurements.state.value.phase)
    }

    /**
     * Out of scope and absent are the same answer on purpose; the message must
     * not suggest the record exists.
     */
    @Test
    fun `treats not found as its own state`() = runTest {
        val measurements = model(FailingTransport(ApiError.NotFound(ErrorResponse(statusCode = 404))))

        measurements.load()

        assertEquals(ChartPhase.NotFound, measurements.state.value.phase)
    }

    /**
     * The chart is redrawn from the server rather than appended to locally: a
     * new weight can move more of the BMI curve than the point just added.
     */
    @Test
    fun `refetches the chart after recording`() = runTest {
        val transport = RecordingTransport(
            mapOf(
                "patients/p1/measurements" to (201 to "{}"),
                "patients/p1/measurements/chart" to (200 to chartJson),
            ),
        )
        val measurements = model(transport)

        val saved = measurements.record(NewMeasurement(MeasurementType.WEIGHT, 66.2))

        assertTrue(saved)
        assertEquals(
            listOf("patients/p1/measurements", "patients/p1/measurements/chart"),
            transport.paths,
        )
    }

    /**
     * Staff readings carry the source; a clinician has to be able to tell a
     * home scale from a clinic one.
     */
    @Test
    fun `sends the source on the staff path`() = runTest {
        val transport = RecordingTransport(
            mapOf(
                "patients/p1/measurements" to (201 to "{}"),
                "patients/p1/measurements/chart" to (200 to chartJson),
            ),
        )
        val measurements = model(transport)

        measurements.record(NewMeasurement(MeasurementType.WEIGHT, 66.2))

        assertTrue(transport.sentBodies.first().contains("\"source\":\"NURSE\""))
    }

    /**
     * On the patient's own path the server refuses the field outright, so it
     * must not be sent at all — sending it would turn every entry into a 400.
     */
    @Test
    fun `omits the source on the patient path`() = runTest {
        val transport = RecordingTransport(
            mapOf(
                "me/measurements" to (201 to "{}"),
                "me/measurements/chart" to (200 to chartJson),
            ),
        )
        val measurements = model(transport, MeasurementSubject.Mine)

        measurements.record(NewMeasurement(MeasurementType.WEIGHT, 66.2))

        val sent = transport.sentBodies.first()

        assertFalse(sent.contains("source"))
        assertTrue(sent.contains("\"type\":\"WEIGHT\""))
    }

    /**
     * A refused reading keeps the server's message, which names the bound that
     * was crossed; replacing it with a generic key would hide which one.
     */
    @Test
    fun `keeps the server message when a value is refused`() = runTest {
        // A real 400 body, so the mapping from response to message is exercised
        // rather than assumed.
        val measurements = model(
            RecordingTransport(
                mapOf(
                    "patients/p1/measurements" to (
                        400 to
                            """{"statusCode":400,"message":"Weight must be between 20 and 400 kg"}"""
                        ),
                ),
            ),
        )

        val saved = measurements.record(NewMeasurement(MeasurementType.WEIGHT, 800.0))

        assertFalse(saved)
        assertEquals(
            UiText.Literal("Weight must be between 20 and 400 kg"),
            measurements.state.value.saveError,
        )
    }

    /** A double tap must not record the same weight twice. */
    @Test
    fun `refuses a second save while one is in flight`() = runTest {
        val transport = RecordingTransport(
            mapOf(
                "patients/p1/measurements" to (201 to "{}"),
                "patients/p1/measurements/chart" to (200 to chartJson),
            ),
            delays = mapOf("patients/p1/measurements" to 500),
        )
        val measurements = model(transport)

        val first = async { measurements.record(NewMeasurement(MeasurementType.WEIGHT, 66.2)) }
        val second = async { measurements.record(NewMeasurement(MeasurementType.WEIGHT, 66.2)) }

        val results = listOf(first.await(), second.await())

        assertEquals(1, results.count { it })
        assertEquals(1, transport.paths.count { it == "patients/p1/measurements" })
    }

    /** A cleared error must not persist into the next attempt. */
    @Test
    fun `clears the previous error on a new save`() = runTest {
        val transport = RecordingTransport(
            mapOf(
                "patients/p1/measurements" to (201 to "{}"),
                "patients/p1/measurements/chart" to (200 to chartJson),
            ),
        )
        val measurements = model(transport)

        measurements.record(NewMeasurement(MeasurementType.WEIGHT, 66.2))

        assertNull(measurements.state.value.saveError)
    }
}
