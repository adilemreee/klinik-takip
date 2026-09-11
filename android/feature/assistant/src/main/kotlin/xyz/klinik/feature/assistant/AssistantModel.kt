package xyz.klinik.feature.assistant

import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.AssistantApi
import xyz.klinik.network.AssistantResult
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

/** One turn of the conversation, as the screen renders it. */
data class AssistantTurn(
    val id: String,
    val question: String,
    val result: AssistantResult? = null,
    /** Set when the ask itself failed — a network error, not a handover. */
    val failure: UiText? = null,
    val escalated: Boolean = false,
) {
    val isAnswered: Boolean get() = result?.answered == true

    /** Still waiting for the server. The question is on screen; the answer is not. */
    val isPending: Boolean get() = result == null && failure == null

    /**
     * Whether this turn can still be handed to a person.
     *
     * A handover has already gone to the clinic — the server did that — so
     * offering it again would send the same question twice.
     */
    val canEscalate: Boolean get() = result?.answered == true && !escalated
}

sealed interface AssistantPhase {
    data object Idle : AssistantPhase
    data object Asking : AssistantPhase
    data class Failed(val message: UiText) : AssistantPhase
}

data class AssistantState(
    val phase: AssistantPhase = AssistantPhase.Idle,
    val turns: List<AssistantTurn> = emptyList(),
    val escalatingId: String? = null,
)

/**
 * The FAQ assistant (spec M4).
 *
 * The rules that matter here are the server's, not this model's: the assistant
 * answers only from the clinic's own documents, it does not diagnose, and when
 * it is not sure it hands the question to a person. This model's job is to not
 * undo any of that — which mostly means rendering a handover as a handover
 * rather than as a failure, and never showing an answer without the button
 * that takes it to a human.
 *
 * A question that could not be sent at all is different again: nothing reached
 * the clinic, and telling somebody "a person will answer this" when nobody has
 * it would be a lie the screen tells on the model's behalf.
 */
class AssistantModel(
    private val api: AssistantApi,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    private val _state = MutableStateFlow(AssistantState())
    val state: StateFlow<AssistantState> = _state.asStateFlow()

    suspend fun ask(question: String) {
        val trimmed = question.trim()
        if (trimmed.isEmpty()) return

        // The question goes on screen before the answer arrives, so somebody
        // can see what they asked while they wait.
        val pendingId = newId()

        _state.value = _state.value.copy(
            phase = AssistantPhase.Asking,
            turns = _state.value.turns + AssistantTurn(id = pendingId, question = trimmed),
        )

        try {
            val result = api.ask(trimmed)

            replace(pendingId) {
                AssistantTurn(
                    id = result.questionMessageId,
                    question = trimmed,
                    result = result,
                    // A handover has already reached the clinic; the server did
                    // that, and offering to send it again would send it twice.
                    escalated = !result.answered,
                )
            }

            _state.value = _state.value.copy(phase = AssistantPhase.Idle)
        } catch (error: Throwable) {
            replace(pendingId) {
                AssistantTurn(id = pendingId, question = trimmed, failure = messageFor(error))
            }

            _state.value = _state.value.copy(phase = AssistantPhase.Idle)
        }
    }

    /** "This answer is not enough, send it to a doctor." */
    suspend fun escalate(turnId: String) {
        _state.value = _state.value.copy(escalatingId = turnId)

        try {
            api.escalate(turnId)

            _state.value = _state.value.copy(
                turns = _state.value.turns.map {
                    if (it.id == turnId) it.copy(escalated = true) else it
                },
                escalatingId = null,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = AssistantPhase.Failed(messageFor(error)),
                escalatingId = null,
            )
        }
    }

    private fun replace(id: String, turn: () -> AssistantTurn) {
        _state.value = _state.value.copy(
            turns = _state.value.turns.map { if (it.id == id) turn() else it },
        )
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
