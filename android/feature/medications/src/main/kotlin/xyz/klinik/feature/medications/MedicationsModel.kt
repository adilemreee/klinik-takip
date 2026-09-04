package xyz.klinik.feature.medications

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import xyz.klinik.network.Adherence
import xyz.klinik.network.ApiError
import xyz.klinik.network.DoseLog
import xyz.klinik.network.Medication
import xyz.klinik.network.MedicationView
import xyz.klinik.network.MedicationsApi
import xyz.klinik.network.messageKey

sealed interface MedicationsPhase {
    data object Loading : MedicationsPhase
    data object Loaded : MedicationsPhase

    /** Nothing prescribed and nothing reported. Not a failure. */
    data object Empty : MedicationsPhase
    data object NotFound : MedicationsPhase
    data class Failed(val messageKey: String) : MedicationsPhase
}

data class MedicationsState(
    val phase: MedicationsPhase = MedicationsPhase.Loading,
    val medications: List<MedicationView> = emptyList(),
    val today: List<DoseLog> = emptyList(),
    val overall: Adherence? = null,
    val badges: List<String> = emptyList(),
    /** The dose being checked in, so its buttons can be disabled. */
    val working: String? = null,
    val error: String? = null,
) {
    val openToday: List<DoseLog> get() = today.filter { it.status.isOpen }

    fun medicationFor(dose: DoseLog): Medication? =
        medications.firstOrNull { it.medication.id == dose.medicationId }?.medication
}

/**
 * The patient's medications and today's check-in (spec M9).
 *
 * Two rules the screen depends on, neither of them cosmetic:
 *
 *   1. **A dose is never flipped locally.** The row is replaced with what the
 *      server returned. A dose showing as taken while the clinic's record says
 *      otherwise is a disagreement nobody notices until somebody is treated on
 *      the wrong assumption.
 *   2. **An absent adherence score is not nought.** A course with nothing due
 *      yet has no score, and drawing that as 0% tells a patient on their first
 *      morning that they are already failing.
 */
class MedicationsModel(private val api: MedicationsApi) {
    private val _state = MutableStateFlow(MedicationsState())
    val state: StateFlow<MedicationsState> = _state.asStateFlow()

    private val checkInLock = Mutex()

    suspend fun load() {
        _state.value = _state.value.copy(phase = MedicationsPhase.Loading, error = null)

        _state.value = try {
            val mine = api.mine()

            _state.value.copy(
                phase = if (mine.medications.isEmpty() && mine.today.isEmpty()) {
                    MedicationsPhase.Empty
                } else {
                    MedicationsPhase.Loaded
                },
                medications = mine.medications,
                today = mine.today,
                overall = mine.overall,
                badges = mine.badges,
            )
        } catch (error: ApiError) {
            // No patient file linked yet — nothing to fetch until the clinic
            // links one, so not a failure to retry.
            val phase = if (error is ApiError.NotFound) {
                MedicationsPhase.NotFound
            } else {
                MedicationsPhase.Failed(error.messageKey())
            }

            _state.value.copy(phase = phase)
        }
    }

    /**
     * Records what the patient did about one dose.
     *
     * Returns whether it reached the clinic. A false must not be shown as a
     * tick: the whole value of the check-in is that the record matches what
     * actually happened.
     */
    suspend fun checkIn(logId: String, action: String, snoozeMinutes: Int? = null): Boolean =
        checkInLock.withLock {
            if (_state.value.working != null) return false

            _state.value = _state.value.copy(working = logId, error = null)

            try {
                val updated = api.checkIn(logId, action, snoozeMinutes)

                _state.value = _state.value.copy(
                    today = _state.value.today.map { if (it.id == updated.id) updated else it },
                    working = null,
                )
                true
            } catch (error: ApiError) {
                _state.value = _state.value.copy(working = null, error = error.messageKey())
                false
            }
        }
}
