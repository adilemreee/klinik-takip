package xyz.klinik.feature.followup

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import xyz.klinik.network.ApiError
import xyz.klinik.network.FollowUpApi
import xyz.klinik.network.FollowUpSchedule
import xyz.klinik.network.Milestone
import xyz.klinik.network.MilestoneStatus
import xyz.klinik.network.UiText
import xyz.klinik.network.messageKey
import xyz.klinik.network.uiText

sealed interface FollowUpPhase {
    data object Loading : FollowUpPhase
    data object Loaded : FollowUpPhase

    /** No schedule yet — usually because the operation has not been recorded. */
    data object None : FollowUpPhase

    data object NotFound : FollowUpPhase
    data class Failed(val messageKey: String) : FollowUpPhase
}

data class FollowUpState(
    val phase: FollowUpPhase = FollowUpPhase.Loading,
    val schedule: FollowUpSchedule? = null,
    /** The milestone being marked, so its buttons can be disabled. */
    val working: String? = null,
    val error: UiText? = null,
) {
    fun next(nowIso: String): Milestone? = schedule?.next(nowIso)

    val missed: List<Milestone> get() = schedule?.missed ?: emptyList()
}

/** The check-up calendar (spec M6). */
class FollowUpModel(
    private val api: FollowUpApi,
    /** Null for the caller's own schedule; a patient id for the staff view. */
    private val patientId: String? = null,
) {
    private val _state = MutableStateFlow(FollowUpState())
    val state: StateFlow<FollowUpState> = _state.asStateFlow()

    private val markLock = Mutex()

    suspend fun refresh() {
        _state.value = _state.value.copy(phase = FollowUpPhase.Loading)

        try {
            val schedule = patientId?.let { api.forPatient(it) } ?: api.mine()

            _state.value = _state.value.copy(
                schedule = schedule,
                phase = if (schedule == null) FollowUpPhase.None else FollowUpPhase.Loaded,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = if (error is ApiError.NotFound) {
                    FollowUpPhase.NotFound
                } else {
                    FollowUpPhase.Failed((error as? ApiError)?.messageKey() ?: "error.server")
                },
            )
        }
    }

    /**
     * Marks a visit attended or skipped.
     *
     * The row is replaced with what the server returned rather than flipped
     * locally: a check-up that shows as attended when the clinic's record says
     * otherwise is the kind of disagreement nobody notices until someone is not
     * called.
     */
    suspend fun mark(milestoneId: String, status: MilestoneStatus): Boolean {
        val schedule = _state.value.schedule ?: return false
        if (!markLock.tryLock()) return false

        _state.value = _state.value.copy(working = milestoneId, error = null)

        val updated = try {
            api.setStatus(milestoneId, status)
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                working = null,
                error = (error as? ApiError)?.uiText() ?: UiText.Key("error.server"),
            )
            return false
        } finally {
            markLock.unlock()
        }

        _state.value = _state.value.copy(
            schedule = schedule.copy(
                milestones = schedule.milestones.map { if (it.id == updated.id) updated else it },
            ),
            working = null,
        )

        return true
    }
}
