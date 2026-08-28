package xyz.klinik.feature.patients

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.Patient
import xyz.klinik.network.PatientsApi
import xyz.klinik.network.messageKey

sealed interface DetailPhase {
    data object Loading : DetailPhase
    data class Loaded(val patient: Patient) : DetailPhase

    /**
     * The record is not there, or is outside this user's scope. The backend
     * makes those indistinguishable on purpose, so the message must not
     * suggest the record exists.
     */
    data object NotFound : DetailPhase

    data class Failed(val messageKey: String) : DetailPhase
}

class PatientDetailModel(
    private val api: PatientsApi,
    private val patientId: String,
) {
    private val _state = MutableStateFlow<DetailPhase>(DetailPhase.Loading)
    val state: StateFlow<DetailPhase> = _state.asStateFlow()

    suspend fun load() {
        _state.value = DetailPhase.Loading

        _state.value = try {
            DetailPhase.Loaded(api.detail(patientId))
        } catch (error: Throwable) {
            // Deliberately not "you do not have access": saying so would
            // confirm the record exists, which is what the backend's 404 avoids.
            if (error is ApiError.NotFound) {
                DetailPhase.NotFound
            } else {
                DetailPhase.Failed((error as? ApiError)?.messageKey() ?: "error.server")
            }
        }
    }
}
