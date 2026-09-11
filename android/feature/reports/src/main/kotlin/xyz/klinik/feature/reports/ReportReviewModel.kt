package xyz.klinik.feature.reports

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.ReportView
import xyz.klinik.network.ReportsApi
import xyz.klinik.network.RiskLevel
import xyz.klinik.network.messageKey

sealed interface ReportReviewPhase {
    data object Loading : ReportReviewPhase
    data object Loaded : ReportReviewPhase

    /** Nothing waiting. A finished queue, not a screen that failed to load. */
    data object Empty : ReportReviewPhase
    data class Failed(val messageKey: String) : ReportReviewPhase
}

data class ReportReviewState(
    val phase: ReportReviewPhase = ReportReviewPhase.Loading,
    val reports: List<ReportView> = emptyList(),
    /** The report a button is waiting on, so only that row is disabled. */
    val busyId: String? = null,
    val actionErrorKey: String? = null,
) {
    /**
     * Highest risk first, then oldest.
     *
     * A critical interpretation generated an hour ago outranks a low-risk one
     * from yesterday, and within a risk level the one that has been waiting
     * longest is the one somebody is still waiting on.
     */
    val ordered: List<ReportView>
        get() = reports.sortedWith(
            compareByDescending<ReportView> { rank(it.report.riskLevel) }
                .thenBy { it.report.generatedAt },
        )

    private companion object {
        fun rank(level: RiskLevel?): Int = when (level) {
            RiskLevel.CRITICAL -> 3
            RiskLevel.HIGH -> 2
            RiskLevel.MEDIUM -> 1
            RiskLevel.LOW, null -> 0
        }
    }
}

/**
 * The queue that unblocks everything else (spec M5).
 *
 * The server holds every AI interpretation until a clinician signs it off, and
 * until this screen existed on Android there was nowhere to do that — so the
 * queue only grew and nothing reached a patient. Reviewing is one action with
 * two outcomes rather than two actions: a doctor who has read the report
 * already knows whether the patient should see it, and splitting the decision
 * would leave a pile of reviewed-but-unreleased reports nobody could tell from
 * unread ones.
 */
class ReportReviewModel(private val api: ReportsApi) {
    private val _state = MutableStateFlow(ReportReviewState())
    val state: StateFlow<ReportReviewState> = _state.asStateFlow()

    suspend fun refresh() {
        _state.value = _state.value.copy(phase = ReportReviewPhase.Loading)

        try {
            val reports = api.pending()

            _state.value = ReportReviewState(
                phase = if (reports.isEmpty()) ReportReviewPhase.Empty else ReportReviewPhase.Loaded,
                reports = reports,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = ReportReviewPhase.Failed(
                    (error as? ApiError)?.messageKey() ?: "error.server",
                ),
            )
        }
    }

    /**
     * Signs one off.
     *
     * `release` decides whether the plain-language half goes to the patient;
     * the clinical half never does either way.
     */
    suspend fun review(reportId: String, release: Boolean) {
        _state.value = _state.value.copy(busyId = reportId, actionErrorKey = null)

        try {
            api.review(reportId, release)

            val remaining = _state.value.reports.filterNot { it.report.id == reportId }

            _state.value = _state.value.copy(
                phase = if (remaining.isEmpty()) ReportReviewPhase.Empty else ReportReviewPhase.Loaded,
                reports = remaining,
                busyId = null,
            )
        } catch (error: Throwable) {
            // The row stays in the list. A report that vanished on a failed
            // sign-off is one nobody would think to look for again.
            _state.value = _state.value.copy(
                busyId = null,
                actionErrorKey = (error as? ApiError)?.messageKey() ?: "error.server",
            )
        }
    }
}
