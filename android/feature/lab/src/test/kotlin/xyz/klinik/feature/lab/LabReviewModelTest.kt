package xyz.klinik.feature.lab

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ApiError
import xyz.klinik.network.ErrorResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.LabApi
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.UiText

/**
 * Nothing on this screen is in the patient's record. The tests that matter are
 * the ones that keep it that way: a row leaves the queue only when a person
 * acted on it, and a failed confirmation must not look like a successful one.
 */
class LabReviewModelTest {
    private fun item(id: String, confidence: String, mapped: Boolean) = """
        {"result":{"id":"$id","analyteCode":${if (mapped) "\"718-7\"" else "null"},
          "analyteName":"Hemoglobin","value":"13.5","unit":"g/dL",
          "refLow":"12","refHigh":"16","flag":"NORMAL",
          "measuredAt":"2026-03-12T08:00:00.000Z","ocrConfidence":"$confidence",
          "verifiedAt":null},
         "needsAttention":${confidence.toDouble() < 0.8},"awaitingMapping":${!mapped}}
    """.trimIndent()

    private val verified = """
        {"id":"r1","analyteCode":"718-7","analyteName":"Hemoglobin","value":"13.5",
         "unit":"g/dL","refLow":"12","refHigh":"16","flag":"NORMAL",
         "measuredAt":"2026-03-12T08:00:00.000Z","ocrConfidence":"0.9",
         "verifiedAt":"2026-03-12T09:00:00.000Z"}
    """.trimIndent()

    private suspend fun model(transport: HttpTransport): LabReviewModel {
        val session = SessionManager(InMemoryTokenStore(), UnusedRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))
        return LabReviewModel(LabApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)), "p1")
    }

    @Test
    fun `loads the queue`() = runTest {
        val review = model(
            RecordingTransport(
                mapOf(
                    "GET patients/p1/lab-results/pending" to
                        (200 to "[${item("r1", "0.42", false)}]"),
                ),
            ),
        )

        review.load()

        val state = review.state.value

        assertEquals(LabReviewPhase.Loaded, state.phase)
        assertEquals(listOf("r1"), state.items.map { it.result.id })
        assertTrue(state.items[0].needsAttention)
        assertTrue(state.items[0].awaitingMapping)
    }

    /** An empty queue is the good state, not a failure. */
    @Test
    fun `reports empty separately from failure`() = runTest {
        val review = model(
            RecordingTransport(mapOf("GET patients/p1/lab-results/pending" to (200 to "[]"))),
        )

        review.load()

        assertEquals(LabReviewPhase.Empty, review.state.value.phase)
    }

    @Test
    fun `counts the ones needing attention`() = runTest {
        val review = model(
            RecordingTransport(
                mapOf(
                    "GET patients/p1/lab-results/pending" to
                        (200 to "[${item("r1", "0.42", true)},${item("r2", "0.99", true)}]"),
                ),
            ),
        )

        review.load()

        assertEquals(1, review.state.value.needingAttention)
    }

    @Test
    fun `removes a confirmed row`() = runTest {
        val review = model(
            RecordingTransport(
                mapOf(
                    "GET patients/p1/lab-results/pending" to (200 to "[${item("r1", "0.9", true)}]"),
                    "PATCH lab-results/r1/verify" to (200 to verified),
                ),
            ),
        )

        review.load()
        val confirmed = review.confirm("r1")

        assertTrue(confirmed)
        assertTrue(review.state.value.items.isEmpty())
        assertEquals(LabReviewPhase.Empty, review.state.value.phase)
    }

    /**
     * The dangerous case. A confirmation the server refused must leave the row
     * where it was: dropping it would show an empty queue for a value that
     * never reached the record.
     */
    @Test
    fun `keeps the row when confirmation fails`() = runTest {
        val review = model(
            RecordingTransport(
                mapOf(
                    "GET patients/p1/lab-results/pending" to (200 to "[${item("r1", "0.9", true)}]"),
                    "PATCH lab-results/r1/verify" to (
                        400 to """{"statusCode":400,"message":"Already verified"}"""
                        ),
                ),
            ),
        )

        review.load()
        val confirmed = review.confirm("r1")

        assertFalse(confirmed)
        assertEquals(listOf("r1"), review.state.value.items.map { it.result.id })
        assertEquals(UiText.Literal("Already verified"), review.state.value.error)
    }

    @Test
    fun `removes a discarded row`() = runTest {
        val review = model(
            RecordingTransport(
                mapOf(
                    "GET patients/p1/lab-results/pending" to (200 to "[${item("r1", "0.3", false)}]"),
                    "DELETE lab-results/r1" to (204 to ""),
                ),
            ),
        )

        review.load()

        assertTrue(review.discard("r1"))
        assertTrue(review.state.value.items.isEmpty())
    }

    /** A double tap must not send two confirmations for the same row. */
    @Test
    fun `refuses a second action while one is in flight`() = runTest {
        val transport = RecordingTransport(
            mapOf(
                "GET patients/p1/lab-results/pending" to (200 to "[${item("r1", "0.9", true)}]"),
                "PATCH lab-results/r1/verify" to (200 to verified),
            ),
            delays = mapOf("PATCH lab-results/r1/verify" to 500),
        )
        val review = model(transport)

        review.load()

        val first = async { review.confirm("r1") }
        val second = async { review.confirm("r1") }

        val results = listOf(first.await(), second.await())

        assertEquals(1, results.count { it })
        assertEquals(1, transport.calls.count { it == "PATCH lab-results/r1/verify" })
    }

    @Test
    fun `treats not found as its own state`() = runTest {
        val review = model(FailingTransport(ApiError.NotFound(ErrorResponse(statusCode = 404))))

        review.load()

        assertEquals(LabReviewPhase.NotFound, review.state.value.phase)
    }
}
