package xyz.klinik.feature.consents

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.Consent
import xyz.klinik.network.ConsentsApi
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface PatientConsentsPhase {
    data object Loading : PatientConsentsPhase
    data object Loaded : PatientConsentsPhase

    /** Nothing on record. A real answer about this patient. */
    data object Empty : PatientConsentsPhase
    data class Failed(val message: UiText) : PatientConsentsPhase
}

data class PatientConsentsState(
    val phase: PatientConsentsPhase = PatientConsentsPhase.Loading,
    /** Everything on record, withdrawn included. */
    val consents: List<Consent> = emptyList(),
    val error: UiText? = null,
) {
    /** In force right now. */
    val inForce: List<Consent> get() = consents.filter { it.active }

    /**
     * Given and taken back.
     *
     * Kept on the screen rather than filtered away: a withdrawal is a thing
     * that happened, and a clinician who cannot see one will assume the
     * consent was never given.
     */
    val withdrawn: List<Consent> get() = consents.filterNot { it.active }
}

/**
 * What a patient has agreed to, read by the clinic (KVKK, spec §8).
 *
 * Read-only on purpose. A clinician cannot give consent on somebody's behalf,
 * and a screen with a switch on it would suggest they could — the patient's
 * own screen is where these are given and withdrawn.
 *
 * The drawn signature is fetched on demand rather than with the list: the link
 * is short-lived, and asking for one for every row would spend them on
 * signatures nobody looked at.
 */
class PatientConsentsModel(
    private val api: ConsentsApi,
    private val patientId: String,
) {
    private val _state = MutableStateFlow(PatientConsentsState())
    val state: StateFlow<PatientConsentsState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = PatientConsentsPhase.Loading)

        try {
            val consents = api.forPatient(patientId).sortedByDescending { it.signedAt }

            _state.value = PatientConsentsState(
                phase = if (consents.isEmpty()) {
                    PatientConsentsPhase.Empty
                } else {
                    PatientConsentsPhase.Loaded
                },
                consents = consents,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = PatientConsentsPhase.Failed(messageFor(error)),
            )
        }
    }

    /**
     * A link to the drawn signature, or null when there is nothing to show.
     *
     * Asked for only where the record says one exists: a link fetched for a
     * consent with no signature is a request that can only fail, and the
     * failure would read as the signature having been lost.
     */
    suspend fun signatureLink(consent: Consent): String? {
        if (!consent.hasSignature) return null

        return try {
            api.signature(consent.id, patientId).url
        } catch (error: Throwable) {
            _state.value = _state.value.copy(error = messageFor(error))
            null
        }
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
