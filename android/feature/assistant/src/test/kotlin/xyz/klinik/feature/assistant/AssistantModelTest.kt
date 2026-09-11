package xyz.klinik.feature.assistant

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.AssistantApi
import xyz.klinik.network.HandoverReason
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object AssistantRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Asking a question must not refresh a session")
}

private class AssistantTransport(private val bodies: Map<String, Pair<Int, String>>) :
    HttpTransport {
    val sent = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/").substringBefore("?")
        sent += "${request.method} $path"

        val (status, body) = bodies["${request.method} $path"] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private const val ANSWERED = """
    {"questionMessageId":"q1","answered":true,
     "answer":"Ameliyattan sonra ilk duş 48 saat sonra alınabilir.",
     "sources":["Taburculuk talimatları"],"handoverReason":null}
"""

private const val HANDED_OVER = """
    {"questionMessageId":"q2","answered":false,"answer":null,
     "sources":[],"handoverReason":"no-sources"}
"""

/**
 * The FAQ assistant (spec M4).
 *
 * The rules are the server's; what is held to here is that the client does not
 * undo them — a handover reads as a handover, an answer always carries the way
 * to a person, and a question that never left the phone is not described as
 * one somebody is reading.
 */
class AssistantModelTest {
    private fun transport(vararg bodies: Pair<String, Pair<Int, String>>) =
        AssistantTransport(bodies.toMap())

    private suspend fun model(transport: AssistantTransport): AssistantModel {
        val session = SessionManager(InMemoryTokenStore(), AssistantRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return AssistantModel(
            AssistantApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
            newId = { "pending" },
        )
    }

    /** An answered question still offers a person. The assistant is not the last word. */
    @Test
    fun `an answer can still be taken to a doctor`() = runTest {
        val subject = model(transport("POST me/assistant/ask" to (200 to ANSWERED)))

        subject.ask("Ne zaman duş alabilirim?")

        val turn = subject.state.value.turns.single()

        assertTrue(turn.isAnswered)
        assertTrue(turn.canEscalate)
        assertEquals("q1", turn.id)
    }

    /**
     * A handover already reached the clinic — the server sent it. Offering to
     * send it again would put the same question in front of a person twice.
     */
    @Test
    fun `a handover is not offered to a person a second time`() = runTest {
        val subject = model(transport("POST me/assistant/ask" to (200 to HANDED_OVER)))

        subject.ask("Bacağımdaki şişlik normal mi?")

        val turn = subject.state.value.turns.single()

        assertFalse(turn.isAnswered)
        assertTrue(turn.escalated)
        assertFalse(turn.canEscalate)
        assertEquals(HandoverReason.NO_SOURCES, turn.result?.handoverReason)
    }

    /**
     * A question that never left the phone is not a handover.
     *
     * Telling somebody a person will answer it, when nobody has it, is a lie
     * the screen would tell on the model's behalf.
     */
    @Test
    fun `a failed ask is a failure and not a handover`() = runTest {
        val subject = model(transport("POST me/assistant/ask" to (500 to "{}")))

        subject.ask("Ne zaman duş alabilirim?")

        val turn = subject.state.value.turns.single()

        assertNotNull(turn.failure)
        assertFalse(turn.escalated)
        assertFalse(turn.canEscalate)
        assertEquals(AssistantPhase.Idle, subject.state.value.phase)
    }

    /** The question is on screen while the answer is still coming. */
    @Test
    fun `the question is shown before the answer arrives`() = runTest {
        val subject = model(transport("POST me/assistant/ask" to (200 to ANSWERED)))

        subject.ask("  Dikişler ne zaman alınır?  ")

        // Trimmed, because the whitespace is not part of what was asked.
        assertEquals("Dikişler ne zaman alınır?", subject.state.value.turns.single().question)
    }

    /** Nothing is sent for an empty box. */
    @Test
    fun `an empty question is not asked`() = runTest {
        val transport = transport("POST me/assistant/ask" to (200 to ANSWERED))
        val subject = model(transport)

        subject.ask("   ")

        assertEquals(emptyList(), transport.sent)
        assertEquals(emptyList(), subject.state.value.turns)
    }

    @Test
    fun `escalating marks the turn and stops offering it`() = runTest {
        val subject = model(
            transport(
                "POST me/assistant/ask" to (200 to ANSWERED),
                "POST me/assistant/q1/escalate" to (204 to ""),
            ),
        )

        subject.ask("Ne zaman duş alabilirim?")
        subject.escalate("q1")

        val turn = subject.state.value.turns.single()

        assertTrue(turn.escalated)
        assertFalse(turn.canEscalate)
        assertEquals(null, subject.state.value.escalatingId)
    }

    /**
     * A failed escalation leaves the button available.
     *
     * The question did not reach anybody, and a turn marked handed-over would
     * leave the patient waiting on a person who was never told.
     */
    @Test
    fun `a failed escalation does not claim a person has it`() = runTest {
        val subject = model(
            transport(
                "POST me/assistant/ask" to (200 to ANSWERED),
                "POST me/assistant/q1/escalate" to (500 to "{}"),
            ),
        )

        subject.ask("Ne zaman duş alabilirim?")
        subject.escalate("q1")

        assertTrue(subject.state.value.turns.single().canEscalate)
        assertTrue(subject.state.value.phase is AssistantPhase.Failed)
    }
}
