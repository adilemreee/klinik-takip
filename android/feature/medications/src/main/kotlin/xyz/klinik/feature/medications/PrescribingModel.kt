package xyz.klinik.feature.medications

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.InteractionCheck
import xyz.klinik.network.MedicationView
import xyz.klinik.network.MedicationsApi
import xyz.klinik.network.Prescription
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface PrescribingPhase {
    data object Loading : PrescribingPhase
    data object Loaded : PrescribingPhase

    /** Nothing prescribed and nothing reported. Not a failure. */
    data object Empty : PrescribingPhase
    data class Failed(val message: UiText) : PrescribingPhase
}

data class PrescribingState(
    val phase: PrescribingPhase = PrescribingPhase.Loading,
    val medications: List<MedicationView> = emptyList(),
    /** What the reference knows about this patient's drugs together. */
    val interactions: InteractionCheck? = null,
    val busyId: String? = null,
    val error: UiText? = null,
) {
    val active: List<MedicationView> get() = medications.filter { it.medication.isActive }

    /**
     * What the patient says they are taking, waiting on a clinician.
     *
     * Its own list because it is a different question: these generate no doses
     * and count towards no adherence until somebody approves them, and a
     * clinician scanning one merged list would read them as prescribed.
     */
    val awaitingApproval: List<MedicationView>
        get() = medications.filter { it.medication.awaitingApproval }

    val stopped: List<MedicationView>
        get() = medications.filter { it.medication.stoppedAt != null }
}

/**
 * The clinician's side of the medication module (spec M9).
 *
 * Until this existed on Android a doctor could read a plan and not write one,
 * which is the wrong way round: the spec has the clinician define the plan and
 * the patient tick the doses off.
 *
 * The interaction check is loaded beside the list rather than only after a
 * write, because a doctor opening this screen is often opening it *to* decide
 * whether to add something. It is best-effort on its own: the reference table
 * being unavailable must not stop somebody reading the plan — and the check's
 * own contract is explicit that a missing warning is not a safety claim.
 */
class PrescribingModel(
    private val api: MedicationsApi,
    private val patientId: String,
) {
    private val _state = MutableStateFlow(PrescribingState())
    val state: StateFlow<PrescribingState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = PrescribingPhase.Loading)

        try {
            val medications = api.forPatient(patientId)
            val interactions = runCatching { api.interactions(patientId) }.getOrNull()

            _state.value = _state.value.copy(
                phase = if (medications.isEmpty()) {
                    PrescribingPhase.Empty
                } else {
                    PrescribingPhase.Loaded
                },
                medications = medications,
                interactions = interactions,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(phase = PrescribingPhase.Failed(messageFor(error)))
        }
    }

    suspend fun prescribe(prescription: Prescription): Boolean {
        _state.value = _state.value.copy(busyId = NEW, error = null)

        return try {
            api.prescribe(patientId, prescription)
            // Reloaded rather than appended: the server generates the doses and
            // recomputes the interaction check, and a locally inserted row
            // would show a schedule nobody had confirmed.
            load()
            _state.value = _state.value.copy(busyId = null)

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busyId = null, error = messageFor(error))
            false
        }
    }

    suspend fun approve(medicationId: String) = write(medicationId) { api.approve(medicationId) }

    suspend fun stop(medicationId: String) = write(medicationId) { api.stop(medicationId) }

    private suspend fun write(id: String, work: suspend () -> MedicationView): Boolean {
        _state.value = _state.value.copy(busyId = id, error = null)

        return try {
            val updated = work()

            _state.value = _state.value.copy(
                // Replaced with what the server returned rather than flipped
                // locally: an approval the server refused must not look
                // applied.
                medications = _state.value.medications.map {
                    if (it.medication.id == id) updated else it
                },
                // A stop or an approval changes what the check compares.
                interactions = runCatching { api.interactions(patientId) }.getOrNull()
                    ?: _state.value.interactions,
                busyId = null,
            )

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busyId = null, error = messageFor(error))
            false
        }
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")

    private companion object {
        /** The id a not-yet-written prescription is busy under. */
        const val NEW = "new"
    }
}
