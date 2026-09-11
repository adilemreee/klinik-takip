package xyz.klinik.feature.emergency

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.EmergencyApi
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object QueueRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading the queue must not refresh a session")
}

private class QueueTransport(private val bodies: Map<String, Pair<Int, String>>) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/").substringBefore("?")
        val (status, body) = bodies["${request.method} $path"] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private fun call(
    id: String,
    waiting: Int,
    unanswered: Boolean = false,
    status: String = "TRIGGERED",
) = """
    {"event":{"id":"$id","patientId":"p1","status":"$status",
      "triggeredAt":"2026-09-11T08:00:00.000Z","latitude":null,"longitude":null,
      "note":null,"escalationLevel":0,"acknowledgedAt":null,"resolution":null,
      "resolvedAt":null},
     "summary":{"patientId":"p1","mrn":"MRN-1","fullName":"Ayşe Yılmaz",
      "sex":"FEMALE","country":"DE"},
     "waitingMinutes":$waiting,"responseMinutes":null,"unanswered":$unanswered}
""".trimIndent()

/**
 * The calls a clinic has not answered (spec M8).
 *
 * The API had this queue from the beginning and nothing on Android drew it, so
 * a patient could press the button and the clinic had no screen that said so.
 * What the model is for is the order and the separation: longest wait first,
 * and the calls the escalation ladder gave up on kept apart from the rest.
 */
class EmergencyQueueModelTest {
    private suspend fun model(vararg bodies: Pair<String, Pair<Int, String>>):
        EmergencyQueueModel {
        val session = SessionManager(InMemoryTokenStore(), QueueRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return EmergencyQueueModel(
            EmergencyApi(
                ApiClient(
                    ApiConfiguration("https://api.test"),
                    QueueTransport(bodies.toMap()),
                    session,
                ),
            ),
        )
    }

    @Test
    fun `the longest wait is first`() = runTest {
        val subject = model(
            "GET emergency" to (200 to "[${call("a", 4)},${call("b", 31)},${call("c", 12)}]"),
        )

        subject.refresh()

        assertEquals(listOf("b", "c", "a"), subject.state.value.calls.map { it.event.id })
    }

    /**
     * "Waiting" and "nobody answered" are different situations, and only one
     * of them is somebody's responsibility this minute.
     */
    @Test
    fun `the unanswered are kept apart from the waiting`() = runTest {
        val subject = model(
            "GET emergency" to (200 to "[${call("a", 4)},${call("b", 40, unanswered = true)}]"),
        )

        subject.refresh()

        assertEquals(listOf("b"), subject.state.value.unanswered.map { it.event.id })
        assertEquals(listOf("a"), subject.state.value.waiting.map { it.event.id })
    }

    /**
     * Nobody waiting is the good state.
     *
     * Its own phase, so the screen can say so rather than drawing an empty
     * list that reads as something that failed to load.
     */
    @Test
    fun `an empty queue is not an error`() = runTest {
        val subject = model("GET emergency" to (200 to "[]"))

        subject.refresh()

        assertTrue(subject.state.value.phase is QueuePhase.Empty)
    }

    /**
     * A closed call leaves the list.
     *
     * This is a list of work, and work that is finished and still on it is how
     * people stop reading a list.
     */
    @Test
    fun `resolving removes the call`() = runTest {
        val subject = model(
            "GET emergency" to (200 to "[${call("a", 4)},${call("b", 9)}]"),
            "PATCH emergency/a/resolve" to (200 to call("a", 4, status = "RESOLVED")),
        )

        subject.refresh()
        subject.resolve("a", "Telefonda halledildi")

        assertEquals(listOf("b"), subject.state.value.calls.map { it.event.id })
    }

    /** And acknowledging does not: somebody is on it, and it is still open. */
    @Test
    fun `acknowledging keeps the call on the list`() = runTest {
        val subject = model(
            "GET emergency" to (200 to "[${call("a", 4)}]"),
            "PATCH emergency/a/acknowledge" to (200 to call("a", 4, status = "ACKNOWLEDGED")),
        )

        subject.refresh()
        subject.acknowledge("a")

        assertEquals(listOf("a"), subject.state.value.calls.map { it.event.id })
        assertTrue(subject.state.value.phase is QueuePhase.Loaded)
    }

    /**
     * A queue that could not be read says so.
     *
     * Drawn as empty it would tell a clinic nobody is waiting, which is the
     * one wrong answer this screen must never give.
     */
    @Test
    fun `a failure is not shown as an empty queue`() = runTest {
        val subject = model()

        subject.refresh()

        assertTrue(subject.state.value.phase is QueuePhase.Failed)
    }
}
