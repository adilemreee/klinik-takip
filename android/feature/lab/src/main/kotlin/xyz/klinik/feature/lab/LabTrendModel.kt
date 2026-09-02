package xyz.klinik.feature.lab

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.AnalyteTrend
import xyz.klinik.network.ApiError
import xyz.klinik.network.LabApi
import xyz.klinik.network.LabResult
import xyz.klinik.network.messageKey

sealed interface LabTrendPhase {
    data object Loading : LabTrendPhase
    data object Loaded : LabTrendPhase

    /** Nothing confirmed yet. Not a failure: results exist only after review. */
    data object Empty : LabTrendPhase

    data object NotFound : LabTrendPhase
    data class Failed(val messageKey: String) : LabTrendPhase
}

data class LabTrendState(
    val phase: LabTrendPhase = LabTrendPhase.Loading,
    val trends: List<AnalyteTrend> = emptyList(),
    /** Confirmed values that need looking at now, kept out of the charts. */
    val critical: List<LabResult> = emptyList(),
    val selected: String? = null,
) {
    val selectedTrend: AnalyteTrend?
        get() = trends.firstOrNull { it.id == selected } ?: trends.firstOrNull()
}

/** The lab trend screen: one series per analyte, with its reference band. */
class LabTrendModel(
    private val api: LabApi,
    private val patientId: String,
) {
    private val _state = MutableStateFlow(LabTrendState())
    val state: StateFlow<LabTrendState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = LabTrendPhase.Loading)

        try {
            // Fetched together so the screen cannot show a chart while still
            // unaware of a critical value on the same patient.
            coroutineScope {
                val trends = async { api.trends(patientId) }
                val critical = async { api.critical(patientId) }

                val series = trends.await()

                _state.value = _state.value.copy(
                    trends = series,
                    critical = critical.await(),
                    selected = series.firstOrNull()?.id,
                    phase = if (series.isEmpty()) LabTrendPhase.Empty else LabTrendPhase.Loaded,
                )
            }
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = if (error is ApiError.NotFound) {
                    LabTrendPhase.NotFound
                } else {
                    LabTrendPhase.Failed((error as? ApiError)?.messageKey() ?: "error.server")
                },
            )
        }
    }

    fun select(id: String) {
        _state.value = _state.value.copy(selected = id)
    }
}
