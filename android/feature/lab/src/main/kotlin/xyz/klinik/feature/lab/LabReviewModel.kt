package xyz.klinik.feature.lab

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import xyz.klinik.network.ApiError
import xyz.klinik.network.LabApi
import xyz.klinik.network.LabCorrection
import xyz.klinik.network.LabReviewItem
import xyz.klinik.network.UiText
import xyz.klinik.network.messageKey
import xyz.klinik.network.uiText

sealed interface LabReviewPhase {
    data object Loading : LabReviewPhase
    data object Loaded : LabReviewPhase

    /** Nothing waiting. The good state, and not the same as a failure. */
    data object Empty : LabReviewPhase

    data object NotFound : LabReviewPhase
    data class Failed(val messageKey: String) : LabReviewPhase
}

data class LabReviewState(
    val phase: LabReviewPhase = LabReviewPhase.Loading,
    val items: List<LabReviewItem> = emptyList(),
    /** The row currently being acted on, so its buttons can be disabled. */
    val working: String? = null,
    val error: UiText? = null,
) {
    /** How many the engine was unsure about — the reason to open this screen. */
    val needingAttention: Int get() = items.count { it.needsAttention }
}

/**
 * The doctor's review queue for what OCR read.
 *
 * Nothing here is in the patient's record yet. That is the whole point: OCR
 * output is never approved automatically (spec M16), and the only way a value
 * becomes clinical is a person confirming it here.
 */
class LabReviewModel(
    private val api: LabApi,
    private val patientId: String,
) {
    private val _state = MutableStateFlow(LabReviewState())
    val state: StateFlow<LabReviewState> = _state.asStateFlow()

    /** Serialises actions so a double tap cannot confirm a row twice. */
    private val lock = Mutex()

    suspend fun load() {
        _state.value = _state.value.copy(phase = LabReviewPhase.Loading)

        try {
            val items = api.pending(patientId)
            _state.value = _state.value.copy(
                items = items,
                phase = if (items.isEmpty()) LabReviewPhase.Empty else LabReviewPhase.Loaded,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = if (error is ApiError.NotFound) {
                    LabReviewPhase.NotFound
                } else {
                    LabReviewPhase.Failed((error as? ApiError)?.messageKey() ?: "error.server")
                },
            )
        }
    }

    /** Confirms one row, with whatever the reviewer corrected. */
    suspend fun confirm(resultId: String, correction: LabCorrection = LabCorrection()): Boolean =
        act(resultId) { api.verify(resultId, correction) }

    /** Drops something OCR read that is not a result at all. */
    suspend fun discard(resultId: String): Boolean = act(resultId) { api.discard(resultId) }

    private suspend fun act(resultId: String, work: suspend () -> Unit): Boolean {
        if (!lock.tryLock()) return false

        _state.value = _state.value.copy(working = resultId, error = null)

        try {
            work()
        } catch (error: Throwable) {
            // The row stays exactly where it was. Dropping it would show an
            // empty queue for a value that never reached the record.
            _state.value = _state.value.copy(
                working = null,
                error = (error as? ApiError)?.uiText() ?: UiText.Key("error.server"),
            )
            return false
        } finally {
            lock.unlock()
        }

        remove(resultId)
        return true
    }

    /**
     * Removed locally rather than by reloading: the reviewer is working down a
     * list, and re-fetching would move rows under their finger.
     */
    private fun remove(resultId: String) {
        val remaining = _state.value.items.filterNot { it.result.id == resultId }

        _state.value = _state.value.copy(
            items = remaining,
            working = null,
            phase = if (remaining.isEmpty()) LabReviewPhase.Empty else _state.value.phase,
        )
    }
}
