package xyz.klinik.feature.surveys

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.PatientSurveys
import xyz.klinik.network.SurveyQuestion
import xyz.klinik.network.SurveysApi
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface SurveyTrendPhase {
    data object Loading : SurveyTrendPhase
    data object Loaded : SurveyTrendPhase

    /** This patient has answered nothing yet. A real answer about them. */
    data object Empty : SurveyTrendPhase
    data class Failed(val message: UiText) : SurveyTrendPhase
}

data class SurveyTrendState(
    val phase: SurveyTrendPhase = SurveyTrendPhase.Loading,
    val surveys: PatientSurveys? = null,
    /** Which question is charted. The first numeric one, until somebody picks. */
    val questionId: String? = null,
) {
    /** Only the questions a line can be drawn from. */
    val chartable: List<SurveyQuestion>
        get() = surveys?.template?.questions.orEmpty().filter { it.isNumeric }

    val question: SurveyQuestion?
        get() = chartable.firstOrNull { it.id == questionId } ?: chartable.firstOrNull()

    /** The series for the chosen question, skipping responses that left it blank. */
    val points get() = question?.let { surveys?.points(it.id) }.orEmpty()

    /**
     * Whether a line can be drawn at all.
     *
     * One point is not a trend, and drawing a single dot as one invites a
     * clinician to read a direction into it.
     */
    val hasTrend: Boolean get() = surveys?.hasTrend == true && points.size > 1

    /** From the most recent response only, and worth reading before the chart. */
    val findings get() = surveys?.latestFindings.orEmpty()
}

/**
 * How a patient's own answers have moved (spec M18).
 *
 * The findings come first and the chart second. A finding is the server's
 * comparison of this patient against themselves — "worse than last time, by
 * enough to mean something" — and it is the thing a clinician needs; the line
 * is how they check it.
 *
 * Only numeric questions are charted. A free-text answer has no position on an
 * axis, and inventing one would put words where a number belongs.
 */
class SurveyTrendModel(
    private val api: SurveysApi,
    private val patientId: String,
) {
    private val _state = MutableStateFlow(SurveyTrendState())
    val state: StateFlow<SurveyTrendState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = SurveyTrendPhase.Loading)

        try {
            val surveys = api.forPatient(patientId)

            _state.value = SurveyTrendState(
                phase = if (surveys.series.isEmpty()) {
                    SurveyTrendPhase.Empty
                } else {
                    SurveyTrendPhase.Loaded
                },
                surveys = surveys,
                questionId = surveys.template.questions.firstOrNull { it.isNumeric }?.id,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(phase = SurveyTrendPhase.Failed(messageFor(error)))
        }
    }

    fun choose(questionId: String) {
        _state.value = _state.value.copy(questionId = questionId)
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
