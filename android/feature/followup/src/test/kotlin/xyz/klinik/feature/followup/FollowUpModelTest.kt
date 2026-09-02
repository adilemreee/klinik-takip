package xyz.klinik.feature.followup

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
import xyz.klinik.network.ErrorResponse
import xyz.klinik.network.FollowUpApi
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.MilestoneStatus
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher
import xyz.klinik.network.UiText

private class RecordingTransport(
    private val bodies: Map<String, Pair<Int, String>>,
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
        error("The calendar must not refresh")
}

private fun milestone(
    id: String,
    label: String,
    dueAt: String,
    status: String = "PENDING",
) = """
    {"id":"$id","label":"$label","dueAt":"$dueAt","status":"$status",
     "notifiedAt":null,"completedAt":null}
""".trimIndent()

private fun schedule(milestones: List<String>) = """
    {"id":"s1","patientId":"p1","surgeryDate":"2026-03-02T09:00:00.000Z",
     "template":"default","milestones":[${milestones.joinToString(",")}]}
""".trimIndent()

/**
 * The check-up calendar.
 *
 * What a patient opens it for is one thing: when do I next have to come in.
 * Everything below is about that answer being right, and about a visit marked
 * attended actually being attended in the clinic's record too.
 */
class FollowUpModelTest {
    private val now = "2026-03-05T00:00:00.000Z"

    private suspend fun model(transport: HttpTransport): FollowUpModel {
        val session = SessionManager(InMemoryTokenStore(), UnusedRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))
        return FollowUpModel(
            FollowUpApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
        )
    }

    @Test
    fun `loads the schedule`() = runTest {
        val followUp = model(
            RecordingTransport(
                mapOf(
                    "GET me/follow-up" to (
                        200 to schedule(
                            listOf(
                                milestone("m1", "D1", "2026-03-03T07:00:00.000Z"),
                                milestone("m2", "W1", "2026-03-09T07:00:00.000Z"),
                            ),
                        )
                        ),
                ),
            ),
        )

        followUp.refresh()

        assertEquals(FollowUpPhase.Loaded, followUp.state.value.phase)
        assertEquals(listOf("D1", "W1"), followUp.state.value.schedule?.milestones?.map { it.label })
    }

    /**
     * No schedule is not a failure: usually the operation has not been recorded
     * yet, and an error would send the patient to the clinic about a problem
     * that is not one.
     */
    @Test
    fun `reports no schedule separately from failure`() = runTest {
        val followUp = model(RecordingTransport(mapOf("GET me/follow-up" to (200 to "{}"))))

        followUp.refresh()

        assertEquals(FollowUpPhase.None, followUp.state.value.phase)
    }

    /** The answer the screen exists to give. */
    @Test
    fun `finds the next visit still ahead`() = runTest {
        val followUp = model(
            RecordingTransport(
                mapOf(
                    "GET me/follow-up" to (
                        200 to schedule(
                            listOf(
                                milestone("m1", "D1", "2026-03-03T07:00:00.000Z", "COMPLETED"),
                                milestone("m2", "W1", "2026-03-09T07:00:00.000Z"),
                                milestone("m3", "M1", "2026-04-02T07:00:00.000Z"),
                            ),
                        )
                        ),
                ),
            ),
        )

        followUp.refresh()

        assertEquals("m2", followUp.state.value.next(now)?.id)
    }

    /** A visit already attended is not the next one to come to. */
    @Test
    fun `skips completed visits when looking ahead`() = runTest {
        val followUp = model(
            RecordingTransport(
                mapOf(
                    "GET me/follow-up" to (
                        200 to schedule(
                            listOf(
                                milestone("m1", "W1", "2026-03-09T07:00:00.000Z", "COMPLETED"),
                                milestone("m2", "M1", "2026-04-02T07:00:00.000Z"),
                            ),
                        )
                        ),
                ),
            ),
        )

        followUp.refresh()

        assertEquals("m2", followUp.state.value.next(now)?.id)
    }

    @Test
    fun `collects missed visits`() = runTest {
        val followUp = model(
            RecordingTransport(
                mapOf(
                    "GET me/follow-up" to (
                        200 to schedule(
                            listOf(milestone("m1", "D1", "2026-03-03T07:00:00.000Z", "MISSED")),
                        )
                        ),
                ),
            ),
        )

        followUp.refresh()

        assertEquals(listOf("m1"), followUp.state.value.missed.map { it.id })
    }

    /**
     * A check-up that shows as attended when the clinic's record says otherwise
     * is the kind of disagreement nobody notices until someone is not called.
     */
    @Test
    fun `keeps what the server returned when marking`() = runTest {
        val followUp = model(
            RecordingTransport(
                mapOf(
                    "GET me/follow-up" to (
                        200 to schedule(listOf(milestone("m1", "W1", "2026-03-09T07:00:00.000Z")))
                        ),
                    "PATCH follow-up/milestones/m1" to (
                        200 to milestone("m1", "W1", "2026-03-09T07:00:00.000Z", "COMPLETED")
                        ),
                ),
            ),
        )

        followUp.refresh()
        val marked = followUp.mark("m1", MilestoneStatus.COMPLETED)

        assertTrue(marked)
        assertEquals(
            MilestoneStatus.COMPLETED,
            followUp.state.value.schedule?.milestones?.first()?.status,
        )
        assertNull(followUp.state.value.next(now))
    }

    /** A refused mark must not leave the row looking attended. */
    @Test
    fun `leaves the row alone when marking fails`() = runTest {
        val followUp = model(
            RecordingTransport(
                mapOf(
                    "GET me/follow-up" to (
                        200 to schedule(listOf(milestone("m1", "W1", "2026-03-09T07:00:00.000Z")))
                        ),
                    "PATCH follow-up/milestones/m1" to (
                        400 to """{"statusCode":400,"message":"A milestone can only be completed, skipped or missed"}"""
                        ),
                ),
            ),
        )

        followUp.refresh()
        val marked = followUp.mark("m1", MilestoneStatus.COMPLETED)

        assertFalse(marked)
        assertEquals(
            MilestoneStatus.PENDING,
            followUp.state.value.schedule?.milestones?.first()?.status,
        )
        assertEquals(
            UiText.Literal("A milestone can only be completed, skipped or missed"),
            followUp.state.value.error,
        )
    }

    /** A double tap must not send two marks for the same visit. */
    @Test
    fun `refuses a second mark while one is in flight`() = runTest {
        val transport = RecordingTransport(
            mapOf(
                "GET me/follow-up" to (
                    200 to schedule(listOf(milestone("m1", "W1", "2026-03-09T07:00:00.000Z")))
                    ),
                "PATCH follow-up/milestones/m1" to (
                    200 to milestone("m1", "W1", "2026-03-09T07:00:00.000Z", "COMPLETED")
                    ),
            ),
            delays = mapOf("PATCH follow-up/milestones/m1" to 300),
        )
        val followUp = model(transport)

        followUp.refresh()

        val first = async { followUp.mark("m1", MilestoneStatus.COMPLETED) }
        val second = async { followUp.mark("m1", MilestoneStatus.SKIPPED) }

        val results = listOf(first.await(), second.await())

        assertEquals(1, results.count { it })
        assertEquals(1, transport.calls.count { it.startsWith("PATCH") })
    }

    @Test
    fun `treats not found as its own state`() = runTest {
        val followUp = model(FailingTransport(ApiError.NotFound(ErrorResponse(statusCode = 404))))

        followUp.refresh()

        assertEquals(FollowUpPhase.NotFound, followUp.state.value.phase)
    }
}
