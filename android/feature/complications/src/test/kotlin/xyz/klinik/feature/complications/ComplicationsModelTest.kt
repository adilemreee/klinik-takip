package xyz.klinik.feature.complications

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ApiError
import xyz.klinik.network.ComplicationStatus
import xyz.klinik.network.ComplicationsApi
import xyz.klinik.network.ErrorResponse
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher
import xyz.klinik.network.UiText

private class RecordingTransport(
    private val bodies: Map<String, Pair<Int, String>>,
    /** Per-path delay, so the concurrency tests actually overlap. */
    private val delays: Map<String, Long> = emptyMap(),
) : HttpTransport {
    val calls = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/").substringBefore("?")
        val key = "${request.method} $path"
        calls += key

        delays[key]?.let { delay(it) }

        val (status, body) = bodies[key] ?: (500 to "{}")
        return HttpResponse(status, body)
    }
}

private class FailingTransport(private val error: ApiError) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse = throw error
}

private object UnusedRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("The complication queue must not refresh")
}

private fun view(
    id: String,
    status: String = "REPORTED",
    waiting: Int = 30,
    response: String = "null",
    overdue: Boolean = false,
    acknowledgedAt: String = "null",
) = """
    {"complication":{"id":"$id","patientId":"p1","status":"$status",
      "note":"Yara kızardı","bodyArea":"abdomen",
      "reportedAt":"2026-03-01T08:00:00.000Z","acknowledgedAt":$acknowledgedAt,
      "firstResponse":$response,"resolvedAt":null,"resolution":null},
     "photos":[],"waitingMinutes":$waiting,
     "responseMinutes":${if (acknowledgedAt == "null") "null" else waiting.toString()},
     "overdue":$overdue}
""".trimIndent()

private suspend fun api(transport: HttpTransport): ComplicationsApi {
    val session = SessionManager(InMemoryTokenStore(), UnusedRefresher)
    session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))
    return ComplicationsApi(ApiClient(ApiConfiguration("https://api.test"), transport, session))
}

/**
 * A report reaching a clinician, and how long it waited. The response time is
 * the only number this feature exists to produce, so the tests are mostly about
 * it staying true — and about a failed reply never looking like a success.
 */
class ComplicationQueueModelTest {
    @Test
    fun `loads the queue`() = runTest {
        val queue = ComplicationQueueModel(
            api(
                RecordingTransport(
                    mapOf("GET complications" to (200 to "[${view("c1", waiting = 200, overdue = true)}]")),
                ),
            ),
        )

        queue.load()

        val state = queue.state.value

        assertEquals(ComplicationsPhase.Loaded, state.phase)
        assertEquals(listOf("c1"), state.items.map { it.complication.id })
        assertEquals(200, state.items[0].waitingMinutes)
        assertTrue(state.items[0].overdue)
    }

    /** The number that makes someone open this screen. */
    @Test
    fun `counts what has waited too long`() = runTest {
        val queue = ComplicationQueueModel(
            api(
                RecordingTransport(
                    mapOf(
                        "GET complications" to (
                            200 to "[${view("c1", waiting = 200, overdue = true)},${view("c2", waiting = 5)}]"
                            ),
                    ),
                ),
            ),
        )

        queue.load()

        assertEquals(1, queue.state.value.overdueCount)
    }

    /** An empty queue is the good state, not a failure. */
    @Test
    fun `reports empty separately from failure`() = runTest {
        val queue = ComplicationQueueModel(
            api(RecordingTransport(mapOf("GET complications" to (200 to "[]")))),
        )

        queue.load()

        assertEquals(ComplicationsPhase.Empty, queue.state.value.phase)
    }

    /**
     * The answered report stays on screen. Taking it away the moment the
     * clinician replied would make them go looking for it again to close it.
     */
    @Test
    fun `keeps an answered report in the list`() = runTest {
        val queue = ComplicationQueueModel(
            api(
                RecordingTransport(
                    mapOf(
                        "GET complications" to (200 to "[${view("c1")}]"),
                        "PATCH complications/c1/acknowledge" to (
                            200 to view(
                                "c1",
                                status = "ACKNOWLEDGED",
                                response = "\"Yarın kontrole gelin\"",
                                acknowledgedAt = "\"2026-03-01T08:30:00.000Z\"",
                            )
                            ),
                    ),
                ),
            ),
        )

        queue.load()
        val answered = queue.acknowledge("c1", "Yarın kontrole gelin")

        val state = queue.state.value

        assertTrue(answered)
        assertEquals(1, state.items.size)
        assertEquals(ComplicationStatus.ACKNOWLEDGED, state.items[0].complication.status)
        assertEquals(30, state.items[0].responseMinutes)
    }

    /** A reply the server refused must not look like one it accepted. */
    @Test
    fun `keeps the row unchanged when answering fails`() = runTest {
        val queue = ComplicationQueueModel(
            api(
                RecordingTransport(
                    mapOf(
                        "GET complications" to (200 to "[${view("c1")}]"),
                        "PATCH complications/c1/acknowledge" to (
                            400 to """{"statusCode":400,"message":"This report has already been answered"}"""
                            ),
                    ),
                ),
            ),
        )

        queue.load()
        val answered = queue.acknowledge("c1", "Görüldü")

        assertFalse(answered)
        assertEquals(ComplicationStatus.REPORTED, queue.state.value.items[0].complication.status)
        assertEquals(
            UiText.Literal("This report has already been answered"),
            queue.state.value.error,
        )
    }

    /** A double tap must not send two replies for the same report. */
    @Test
    fun `refuses a second action while one is in flight`() = runTest {
        val transport = RecordingTransport(
            mapOf(
                "GET complications" to (200 to "[${view("c1")}]"),
                "PATCH complications/c1/acknowledge" to (
                    200 to view("c1", status = "ACKNOWLEDGED", acknowledgedAt = "\"2026-03-01T08:30:00.000Z\"")
                    ),
            ),
            delays = mapOf("PATCH complications/c1/acknowledge" to 300),
        )
        val queue = ComplicationQueueModel(api(transport))

        queue.load()

        val first = async { queue.acknowledge("c1", "Görüldü") }
        val second = async { queue.acknowledge("c1", "Görüldü") }

        val results = listOf(first.await(), second.await())

        assertEquals(1, results.count { it })
        assertEquals(1, transport.calls.count { it == "PATCH complications/c1/acknowledge" })
    }
}

class MyComplicationsModelTest {
    /**
     * A patient who cannot see an answer reports the same worry again. The
     * reply is the point of this screen.
     */
    @Test
    fun `shows the clinic reply`() = runTest {
        val mine = MyComplicationsModel(
            api(
                RecordingTransport(
                    mapOf(
                        "GET me/complications" to (
                            200 to "[${view("c1", status = "ACKNOWLEDGED", response = "\"Yarın kontrole gelin\"", acknowledgedAt = "\"2026-03-01T08:30:00.000Z\"")}]"
                            ),
                    ),
                ),
            ),
        )

        mine.load()

        assertEquals("Yarın kontrole gelin", mine.state.value.items[0].complication.firstResponse)
    }

    @Test
    fun `reports and reloads`() = runTest {
        val transport = RecordingTransport(
            mapOf(
                "POST me/complications" to (201 to view("c1")),
                "GET me/complications" to (200 to "[${view("c1")}]"),
            ),
        )
        val mine = MyComplicationsModel(api(transport))

        val sent = mine.report("Yara kızardı", "abdomen")

        assertTrue(sent)
        // Reloaded from the server rather than assuming what was stored.
        assertEquals(listOf("POST me/complications", "GET me/complications"), transport.calls)
    }

    /** The server refuses a report with no description and says so. */
    @Test
    fun `keeps the server message when a report is refused`() = runTest {
        val mine = MyComplicationsModel(
            api(
                RecordingTransport(
                    mapOf(
                        "POST me/complications" to (
                            400 to """{"statusCode":400,"message":"Describe what is wrong"}"""
                            ),
                    ),
                ),
            ),
        )

        val sent = mine.report("   ")

        assertFalse(sent)
        assertEquals(UiText.Literal("Describe what is wrong"), mine.state.value.error)
    }

    /** A double tap must not file the same report twice. */
    @Test
    fun `refuses a second report while one is in flight`() = runTest {
        val transport = RecordingTransport(
            mapOf(
                "POST me/complications" to (201 to view("c1")),
                "GET me/complications" to (200 to "[${view("c1")}]"),
            ),
            delays = mapOf("POST me/complications" to 300),
        )
        val mine = MyComplicationsModel(api(transport))

        val first = async { mine.report("Yara kızardı") }
        val second = async { mine.report("Yara kızardı") }

        val results = listOf(first.await(), second.await())

        assertEquals(1, results.count { it })
        assertEquals(1, transport.calls.count { it == "POST me/complications" })
    }

    @Test
    fun `reports not found when the account has no file`() = runTest {
        val mine = MyComplicationsModel(
            api(FailingTransport(ApiError.NotFound(ErrorResponse(statusCode = 404)))),
        )

        mine.load()

        assertEquals(ComplicationsPhase.NotFound, mine.state.value.phase)
    }
}
