package xyz.klinik.feature.emergency

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import xyz.klinik.network.ApiError
import xyz.klinik.network.EmergencyApi
import xyz.klinik.network.EmergencyStatus
import xyz.klinik.network.StaffEmergencyView
import xyz.klinik.network.UiText
import xyz.klinik.network.messageKey
import xyz.klinik.network.uiText

sealed interface QueuePhase {
    data object Loading : QueuePhase
    data object Loaded : QueuePhase

    /** Nobody is waiting. The good state, and it should look like one. */
    data object Empty : QueuePhase

    data class Failed(val messageKey: String) : QueuePhase
}

data class EmergencyQueueState(
    val phase: QueuePhase = QueuePhase.Loading,
    /** Longest wait first — see [EmergencyQueueModel.refresh]. */
    val calls: List<StaffEmergencyView> = emptyList(),
    /** The call being acted on, so its buttons can be disabled. */
    val working: String? = null,
    val error: UiText? = null,
) {
    /**
     * The ones the escalation ladder ran out on.
     *
     * Shown apart from the rest, because "waiting" and "nobody answered" are
     * different situations and the second one is somebody's responsibility
     * right now.
     */
    val unanswered: List<StaffEmergencyView> get() = calls.filter { it.unanswered }

    val waiting: List<StaffEmergencyView> get() = calls.filter { !it.unanswered }
}

/**
 * The calls a clinic has not answered yet (spec M8).
 *
 * The first screen of a shift. A patient presses the button and the clinic has
 * to see it — which until now, on Android, it could not: the API had the queue
 * and nothing drew it.
 *
 * Closed calls are left out. This is a list of work, and a list of work that
 * also contains finished work is one people stop reading.
 */
class EmergencyQueueModel(private val api: EmergencyApi) {
    private val _state = MutableStateFlow(EmergencyQueueState())
    val state: StateFlow<EmergencyQueueState> = _state.asStateFlow()

    private val actionLock = Mutex()

    suspend fun refresh() {
        _state.value = _state.value.copy(phase = QueuePhase.Loading)

        try {
            // Longest wait first. The server orders by when the button was
            // pressed; this is the same order said out loud, so a reordering
            // there cannot quietly change which call a clinician sees first.
            val calls = api.queue().sortedByDescending { it.waitingMinutes }

            _state.value = _state.value.copy(
                calls = calls,
                phase = if (calls.isEmpty()) QueuePhase.Empty else QueuePhase.Loaded,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = QueuePhase.Failed(
                    (error as? ApiError)?.messageKey() ?: "error.server",
                ),
            )
        }
    }

    /**
     * Says somebody is on it.
     *
     * The gap between this and the button being pressed is the response time
     * the clinic is measured on, so it is recorded the moment a person takes
     * the call rather than when they finish it.
     */
    suspend fun acknowledge(emergencyId: String): Boolean =
        act(emergencyId) { api.acknowledge(emergencyId) }

    /**
     * Closes a call.
     *
     * `falseAlarm` is separate from the resolution text on purpose: a pocket
     * press and a call that was handled are both closed, and an adherence
     * report that counts them together is a report nobody can use.
     */
    suspend fun resolve(
        emergencyId: String,
        resolution: String,
        falseAlarm: Boolean = false,
    ): Boolean = act(emergencyId) { api.resolve(emergencyId, resolution, falseAlarm) }

    private suspend fun act(
        emergencyId: String,
        work: suspend () -> StaffEmergencyView,
    ): Boolean {
        if (!actionLock.tryLock()) return false

        _state.value = _state.value.copy(working = emergencyId, error = null)

        val updated = try {
            work()
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                working = null,
                error = (error as? ApiError)?.uiText() ?: UiText.Key("error.server"),
            )
            return false
        } finally {
            actionLock.unlock()
        }

        /*
         * Replaced with what the server returned, and dropped once it is
         * closed.
         *
         * Flipping the row locally would leave a clinic looking at a call
         * marked handled that the server never accepted — which on this
         * particular list means somebody is waiting and nobody thinks so.
         */
        val remaining = _state.value.calls
            .map { if (it.event.id == updated.event.id) updated else it }
            .filterNot { it.event.status == EmergencyStatus.RESOLVED }
            .filterNot { it.event.status == EmergencyStatus.FALSE_ALARM }

        _state.value = _state.value.copy(
            calls = remaining,
            working = null,
            phase = if (remaining.isEmpty()) QueuePhase.Empty else QueuePhase.Loaded,
        )

        return true
    }
}
