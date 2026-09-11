package xyz.klinik.feature.lab

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.LabApi
import xyz.klinik.network.LabPanel
import xyz.klinik.network.RecordSubject
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface LabPanelsPhase {
    data object Loading : LabPanelsPhase
    data object Loaded : LabPanelsPhase

    /**
     * Nothing confirmed yet.
     *
     * Not the same as nothing uploaded: a document sits unverified until a
     * clinician confirms the readings, and the screen says so rather than
     * looking like the upload was lost.
     */
    data object Empty : LabPanelsPhase
    data class Failed(val message: UiText) : LabPanelsPhase
}

data class LabPanelsState(
    val phase: LabPanelsPhase = LabPanelsPhase.Loading,
    /** Newest sample first — the sheet somebody came to read. */
    val panels: List<LabPanel> = emptyList(),
    /** Which sheets are open. The newest starts open; the rest are collapsed. */
    val expanded: Set<String> = emptySet(),
) {
    fun isExpanded(panel: LabPanel): Boolean = key(panel) in expanded

    companion object {
        /** A panel has no id of its own; the sample time and report identify it. */
        fun key(panel: LabPanel): String = "${panel.measuredAt}|${panel.documentId.orEmpty()}"
    }
}

/**
 * Confirmed lab results, grouped the way the laboratory printed them (M16).
 *
 * A lab report is read as a panel — the whole sheet from one blood draw — and
 * scattering the rows into per-analyte lists makes a clinician reassemble what
 * the laboratory already grouped. The trend chart is the other view of the
 * same data and answers a different question.
 */
class LabPanelsModel(
    private val api: LabApi,
    private val subject: RecordSubject,
) {
    private val _state = MutableStateFlow(LabPanelsState())
    val state: StateFlow<LabPanelsState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = LabPanelsPhase.Loading)

        try {
            val panels = api.panels(subject).sortedByDescending { it.measuredAt }

            _state.value = LabPanelsState(
                phase = if (panels.isEmpty()) LabPanelsPhase.Empty else LabPanelsPhase.Loaded,
                panels = panels,
                // The most recent draw open, the rest closed: somebody opening
                // this screen came to read the latest sheet, and eleven
                // expanded panels is a page nobody can find anything in.
                expanded = panels.take(1).map { LabPanelsState.key(it) }.toSet(),
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(phase = LabPanelsPhase.Failed(messageFor(error)))
        }
    }

    fun toggle(panel: LabPanel) {
        val key = LabPanelsState.key(panel)
        val expanded = _state.value.expanded

        _state.value = _state.value.copy(
            expanded = if (key in expanded) expanded - key else expanded + key,
        )
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
