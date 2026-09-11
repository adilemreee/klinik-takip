package xyz.klinik.feature.reports

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.PatientReport
import xyz.klinik.network.ReportsApi
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface MyReportsPhase {
    data object Loading : MyReportsPhase
    data object Loaded : MyReportsPhase

    /** Nothing has been shared. Not nothing wrong. */
    data object Empty : MyReportsPhase
    data class Failed(val message: UiText) : MyReportsPhase
}

data class MyReportsState(
    val phase: MyReportsPhase = MyReportsPhase.Loading,
    /** Newest first: the one a patient came to read is the one just released. */
    val reports: List<PatientReport> = emptyList(),
)

/**
 * The patient's side of the report queue (spec M5).
 *
 * `me/reports` returns only what a clinician released — the filter is the
 * server's, not this model's, and it stays that way: a client that fetched
 * everything and hid the unreleased ones would be one bug away from showing an
 * unreviewed AI reading to the person it is about.
 */
class MyReportsModel(private val api: ReportsApi) {
    private val _state = MutableStateFlow(MyReportsState())
    val state: StateFlow<MyReportsState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = MyReportsPhase.Loading)

        try {
            val reports = api.mine().sortedByDescending { it.releasedAt }

            _state.value = MyReportsState(
                phase = if (reports.isEmpty()) MyReportsPhase.Empty else MyReportsPhase.Loaded,
                reports = reports,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = MyReportsPhase.Failed(
                    (error as? ApiError)?.uiText() ?: UiText.Key("error.server"),
                ),
            )
        }
    }
}
