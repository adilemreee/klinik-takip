package xyz.klinik.feature.home

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import xyz.klinik.network.ApiError
import xyz.klinik.network.messageKey

/**
 * Sends the alert. A port rather than a concrete call: the endpoint arrives
 * with the emergency module in T4.5, and the confirmation behaviour around it
 * is worth having and testing now.
 */
fun interface EmergencyTrigger {
    suspend fun trigger(note: String?)
}

sealed interface EmergencyPhase {
    data object Idle : EmergencyPhase

    /** Armed and waiting for the confirming tap. Disarms on its own. */
    data class Confirming(val secondsRemaining: Int) : EmergencyPhase

    data object Sending : EmergencyPhase

    /** The clinic has it. Only ever set after the server confirms. */
    data object Sent : EmergencyPhase

    /**
     * It did not reach the clinic. The screen must say so rather than leaving
     * the patient to assume help is coming.
     */
    data class Failed(val messageKey: String, val canRetry: Boolean) : EmergencyPhase
}

/**
 * Two-step confirmation for the emergency button (spec M8).
 *
 * Both mistakes are costly and they pull in opposite directions. A stray tap in
 * a pocket spends clinical attention someone else may need. A tap that fails to
 * send, in a real emergency, is far worse — so nothing here reports success
 * until the server has confirmed it, and a failure says plainly that the clinic
 * does not know.
 */
class EmergencyModel(
    private val trigger: EmergencyTrigger,
    private val scope: CoroutineScope,
    private val confirmationWindowSeconds: Int = 5,
) {
    private val _state = MutableStateFlow<EmergencyPhase>(EmergencyPhase.Idle)
    val state: StateFlow<EmergencyPhase> = _state.asStateFlow()

    private var countdown: Job? = null
    private var pendingNote: String? = null

    /** First tap. Arms the button and starts the countdown; sends nothing. */
    fun arm(note: String? = null) {
        if (_state.value !is EmergencyPhase.Idle) return

        pendingNote = note
        _state.value = EmergencyPhase.Confirming(confirmationWindowSeconds)

        countdown?.cancel()
        countdown = scope.launch {
            for (remaining in confirmationWindowSeconds - 1 downTo 0) {
                delay(1_000)
                if (_state.value !is EmergencyPhase.Confirming) return@launch

                if (remaining == 0) {
                    // Disarmed by time rather than sent. A button that stays
                    // armed indefinitely is one a pocket eventually presses.
                    _state.value = EmergencyPhase.Idle
                    pendingNote = null
                } else {
                    _state.value = EmergencyPhase.Confirming(remaining)
                }
            }
        }
    }

    /** Second tap. Only this sends. */
    suspend fun confirm() {
        if (_state.value !is EmergencyPhase.Confirming) return

        countdown?.cancel()
        countdown = null
        _state.value = EmergencyPhase.Sending

        _state.value = try {
            trigger.trigger(pendingNote)
            pendingNote = null
            EmergencyPhase.Sent
        } catch (error: Throwable) {
            // Offline is called out separately: the patient needs to know the
            // clinic has *not* been told, and to use the local emergency number
            // rather than wait.
            val apiError = error as? ApiError

            // An unrecognised failure is treated as retryable: in an emergency,
            // offering another attempt is the safer default.
            if (apiError == null || apiError.isRetryable) {
                EmergencyPhase.Failed(messageKey = "emergency.notSentRetry", canRetry = true)
            } else {
                EmergencyPhase.Failed(messageKey = apiError.messageKey(), canRetry = false)
            }
        }
    }

    /** Explicit cancel, or leaving the screen. */
    fun cancel() {
        countdown?.cancel()
        countdown = null
        pendingNote = null
        _state.value = EmergencyPhase.Idle
    }

    /** Returns to idle after the patient has read the outcome. */
    fun acknowledge() {
        if (_state.value is EmergencyPhase.Sent || _state.value is EmergencyPhase.Failed) {
            _state.value = EmergencyPhase.Idle
        }
    }
}
