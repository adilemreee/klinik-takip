package xyz.klinik.feature.documents

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.DocumentChecklist
import xyz.klinik.network.DocumentsApi
import xyz.klinik.network.RecordSubject
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface ChecklistPhase {
    data object Loading : ChecklistPhase
    data object Loaded : ChecklistPhase

    /** The clinic has defined no list. Not the same as nothing outstanding. */
    data object Empty : ChecklistPhase
    data class Failed(val message: UiText) : ChecklistPhase
}

data class ChecklistState(
    val phase: ChecklistPhase = ChecklistPhase.Loading,
    val checklist: DocumentChecklist? = null,
) {
    val outstanding get() = checklist?.outstanding.orEmpty()
    val done get() = checklist?.done.orEmpty()
    val missingMandatory: Int get() = checklist?.missingMandatory ?: 0

    /** Nothing mandatory outstanding. Said out loud, because it is the answer. */
    val complete: Boolean get() = checklist?.complete == true
}

/**
 * What the clinic still needs before the operation (spec M17).
 *
 * The satisfied items stay on the list. A checklist showing only what is
 * missing gives a patient no way to tell "you have sent everything" from "the
 * list did not load" — and the first of those is the thing they came to find
 * out.
 */
class ChecklistModel(
    private val api: DocumentsApi,
    private val subject: RecordSubject,
) {
    private val _state = MutableStateFlow(ChecklistState())
    val state: StateFlow<ChecklistState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = ChecklistPhase.Loading)

        try {
            val checklist = api.checklist(subject)

            _state.value = ChecklistState(
                phase = if (checklist.items.isEmpty()) {
                    ChecklistPhase.Empty
                } else {
                    ChecklistPhase.Loaded
                },
                checklist = checklist,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(phase = ChecklistPhase.Failed(messageFor(error)))
        }
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
