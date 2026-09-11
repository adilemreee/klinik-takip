package xyz.klinik.feature.briefing

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.Briefing
import xyz.klinik.network.BriefingApi
import xyz.klinik.network.RiskItem
import xyz.klinik.network.RiskKind
import xyz.klinik.network.messageKey

sealed interface BriefingPhase {
    data object Loading : BriefingPhase
    data object Loaded : BriefingPhase

    /**
     * Nothing needs attention.
     *
     * A real answer, and a different one from an empty screen: a clinician
     * who reads "nothing waiting" has been told something, and one who reads a
     * blank page has been told the app is broken.
     */
    data object Quiet : BriefingPhase

    data class Failed(val messageKey: String) : BriefingPhase
}

data class BriefingState(
    val phase: BriefingPhase = BriefingPhase.Loading,
    val briefing: Briefing? = null,
) {
    /**
     * What to look at first, worst first.
     *
     * An unanswered emergency outranks everything; after that the order is the
     * one the risks were listed in, which is the server's and not this
     * client's to invent.
     */
    val atRisk: List<RiskItem>
        get() = briefing?.facts?.atRisk.orEmpty()
            .sortedBy { ORDER.indexOf(it.kind).takeIf { index -> index >= 0 } ?: ORDER.size }

    /** The paragraph, when the AI layer wrote one. Never the screen's content. */
    val narrative: String? get() = briefing?.narrative

    private companion object {
        /**
         * Worst first.
         *
         * A clinician reads this list from the top and stops when the phone
         * rings, so the order is the whole value of it. An unanswered
         * emergency is somebody waiting for help; an unreviewed report is
         * paperwork.
         */
        val ORDER = listOf(
            RiskKind.EMERGENCY_UNANSWERED,
            RiskKind.MESSAGE_URGENT,
            RiskKind.COMPLICATION_OVERDUE,
            RiskKind.FOLLOW_UP_MISSED,
            RiskKind.REPORT_UNREVIEWED,
        )
    }
}

/**
 * The clinician's morning (spec M5).
 *
 * Numbers first and the paragraph second, deliberately. The briefing *is* the
 * facts — how many messages came in overnight, who is waiting, what was
 * missed — and the AI layer's prose is a reading of them. A screen drawn off
 * the prose would make a switched-off AI layer look like an empty morning,
 * which is the one impression this screen must never give.
 */
class BriefingModel(private val api: BriefingApi) {
    private val _state = MutableStateFlow(BriefingState())
    val state: StateFlow<BriefingState> = _state.asStateFlow()

    suspend fun refresh() {
        _state.value = _state.value.copy(phase = BriefingPhase.Loading)

        try {
            val briefing = api.mine()

            _state.value = BriefingState(
                phase = if (briefing.hasContent) BriefingPhase.Loaded else BriefingPhase.Quiet,
                briefing = briefing,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = BriefingPhase.Failed(
                    (error as? ApiError)?.messageKey() ?: "error.server",
                ),
            )
        }
    }
}
