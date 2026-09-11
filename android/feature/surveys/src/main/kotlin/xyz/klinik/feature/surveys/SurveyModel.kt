package xyz.klinik.feature.surveys

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.PendingSurvey
import xyz.klinik.network.SurveyAnswer
import xyz.klinik.network.SurveysApi
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface SurveyPhase {
    data object Loading : SurveyPhase
    data object Loaded : SurveyPhase

    /** Nothing to fill in. Not a failure. */
    data object None : SurveyPhase
    data class Failed(val message: UiText) : SurveyPhase
}

data class SurveyState(
    val phase: SurveyPhase = SurveyPhase.Loading,
    val surveys: List<PendingSurvey> = emptyList(),
    /** Answers for the survey on screen, keyed by question. */
    val answers: Map<String, SurveyAnswer> = emptyMap(),
    val submitting: Boolean = false,
    val submitted: Boolean = false,
    val error: UiText? = null,
    /** The clock the form is measured against, so "expired" is testable. */
    internal val now: String = "",
) {
    /** The one being answered: the earliest still open. */
    val current: PendingSurvey? get() = surveys.firstOrNull { it.isOpen(now) }

    /**
     * The ones whose window has closed.
     *
     * Shown as closed rather than hidden: somebody opening the app a week
     * after the reminder should be told they missed it, not left wondering
     * whether the app forgot to ask.
     */
    val missed: List<PendingSurvey> get() = surveys.filterNot { it.isOpen(now) }

    /** Whether every required question has an answer. */
    val canSubmit: Boolean
        get() = current?.requiredQuestions?.all { answers[it.id] != null } == true
}

/**
 * The short questionnaires a patient fills in after surgery (spec M18).
 *
 * Answers are held until the whole form is sent. A survey saved question by
 * question would leave half-answered forms in the record that read as a
 * patient reporting nothing about the rest — and a pain score of "nothing" is
 * a clinical statement, not an absence.
 *
 * Nothing here reads the answers back to the patient. The server computes
 * findings for the clinic; "your reported pain has worsened" is a clinical
 * reading, and a questionnaire screen is not the thing that should deliver
 * one.
 */
class SurveyModel(
    private val api: SurveysApi,
    /** ISO-8601 UTC, injected so an expiring form can be tested without waiting. */
    private val now: () -> String,
) {
    private val _state = MutableStateFlow(SurveyState())
    val state: StateFlow<SurveyState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = SurveyPhase.Loading)

        try {
            val surveys = api.mine().sortedBy { it.scheduledFor }
            val moment = now()

            _state.value = SurveyState(
                phase = if (surveys.none { it.isOpen(moment) }) {
                    SurveyPhase.None
                } else {
                    SurveyPhase.Loaded
                },
                surveys = surveys,
                now = moment,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(phase = SurveyPhase.Failed(messageFor(error)))
        }
    }

    fun answer(questionId: String, answer: SurveyAnswer) {
        _state.value = _state.value.copy(answers = _state.value.answers + (questionId to answer))
    }

    suspend fun submit() {
        val survey = _state.value.current ?: return
        if (!_state.value.canSubmit) return

        _state.value = _state.value.copy(submitting = true, error = null)

        try {
            api.submit(survey.id, _state.value.answers)

            val remaining = _state.value.surveys.filterNot { it.id == survey.id }
            val moment = now()

            _state.value = _state.value.copy(
                phase = if (remaining.none { it.isOpen(moment) }) {
                    SurveyPhase.None
                } else {
                    SurveyPhase.Loaded
                },
                surveys = remaining,
                answers = emptyMap(),
                submitting = false,
                submitted = true,
                now = moment,
            )
        } catch (error: Throwable) {
            // The answers stay in `answers`. Ten minutes of somebody's
            // attention is not something to throw away because the network
            // dropped: the form is still on screen, filled in, with the reason
            // it did not go.
            _state.value = _state.value.copy(submitting = false, error = messageFor(error))
        }
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
