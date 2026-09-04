package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Patient-reported outcome questionnaires (spec M18, T6.7).
 *
 * The patient's screen and the clinician's screen read the same data and must
 * not say the same things about it. A patient sees the questions and their own
 * answers; they never see a finding, because "your reported pain has worsened"
 * is a clinical reading and this is not the thing that should deliver one.
 */

@Serializable
enum class SurveyAnswerType {
    SCALE_0_10,
    YES_NO,
    TEXT,
}

@Serializable
enum class SurveyDirection {
    /** Pain, swelling: a higher answer is a worse one. */
    @kotlinx.serialization.SerialName("higher-is-worse")
    HIGHER_IS_WORSE,

    /** Sleep, satisfaction. */
    @kotlinx.serialization.SerialName("higher-is-better")
    HIGHER_IS_BETTER,
}

@Serializable
data class SurveyQuestion(
    val id: String,
    val text: String,
    val type: SurveyAnswerType,
    /** Which way is bad. Absent on questions that are not scales. */
    val direction: SurveyDirection? = null,
    val alarmAt: Int? = null,
    val required: Boolean = false,
) {
    /** Whether a chart can plot this one. */
    val isNumeric: Boolean
        get() = type == SurveyAnswerType.SCALE_0_10 || type == SurveyAnswerType.YES_NO
}

@Serializable
data class PendingSurvey(
    val id: String,
    val title: String,
    val description: String? = null,
    /** Days after the operation this one is about. */
    val milestoneDays: Int,
    val scheduledFor: String,
    /** After this it can no longer be answered. */
    val expiresAt: String? = null,
    val questions: List<SurveyQuestion> = emptyList(),
) {
    /**
     * Whether it is still open.
     *
     * A late answer is refused by the server, so the form must not invite one:
     * asking somebody to fill in five questions and then rejecting them is
     * worse than not asking.
     */
    fun isOpen(nowIso: String): Boolean = expiresAt?.let { it > nowIso } ?: true

    val requiredQuestions: List<SurveyQuestion> get() = questions.filter { it.required }
}

/** What the patient is told back. Deliberately not a reading of their answers. */
@Serializable
data class SurveySubmitResult(val invited: Boolean = false)

@Serializable
enum class SurveyFindingKind {
    /** Worse than this patient's own previous answer, by enough to mean something. */
    @kotlinx.serialization.SerialName("worsened")
    WORSENED,

    /** Past the question's own threshold, whatever the trend. */
    @kotlinx.serialization.SerialName("severe")
    SEVERE,
    ;

    val stringKey: String get() = "survey_finding_${name.lowercase()}"
}

@Serializable
data class SurveyFinding(
    val kind: SurveyFindingKind,
    val questionId: String,
    val questionText: String,
    val value: Int,
    /** The same question last time. Absent on a severe finding. */
    val previous: Int? = null,
)

@Serializable
data class SurveyPoint(
    val assignmentId: String,
    val milestoneDays: Int,
    val submittedAt: String,
    /** Question id to answer. */
    val values: Map<String, Int> = emptyMap(),
    val answeredCount: Int = 0,
    val questionCount: Int = 0,
    /**
     * Too little was answered for this point to sit beside a full one.
     *
     * Still drawn — the answers are real — but a chart has to mark it, or a
     * single answer out of five reads as a complete assessment.
     */
    val partial: Boolean = false,
)

@Serializable
data class SurveyTemplateInfo(
    val code: String,
    val version: Int,
    val title: String,
    val questions: List<SurveyQuestion> = emptyList(),
)

@Serializable
data class PatientSurveys(
    val template: SurveyTemplateInfo,
    /** Oldest first. */
    val series: List<SurveyPoint> = emptyList(),
    /** From the most recent response only. */
    val latestFindings: List<SurveyFinding> = emptyList(),
    /** False while there is one response: a line needs two points. */
    val hasTrend: Boolean = false,
) {
    /** The series for one question, skipping the responses that left it blank. */
    fun points(questionId: String): List<Pair<SurveyPoint, Int>> =
        series.mapNotNull { point -> point.values[questionId]?.let { point to it } }

    val needsAttention: Boolean get() = latestFindings.isNotEmpty()
}

/** One answer, in the shape its question expects. */
sealed interface SurveyAnswer {
    data class Scale(val value: Int) : SurveyAnswer
    data class YesNo(val value: Boolean) : SurveyAnswer
    data class Text(val value: String) : SurveyAnswer

    fun toJson(): JsonElement = when (this) {
        is Scale -> JsonPrimitive(value)
        is YesNo -> JsonPrimitive(value)
        is Text -> JsonPrimitive(value)
    }
}

class SurveysApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /** Questionnaires waiting for me. */
    suspend fun mine(): List<PendingSurvey> =
        decode(client.send(Endpoint(HttpMethod.GET, "me/surveys")))

    /** Answers. A value that does not fit its question is refused by the server. */
    suspend fun submit(assignmentId: String, answers: Map<String, SurveyAnswer>): SurveySubmitResult {
        val body = JsonObject(
            mapOf("answers" to JsonObject(answers.mapValues { (_, answer) -> answer.toJson() })),
        )

        return decode(
            client.send(
                Endpoint(HttpMethod.POST, "me/surveys/$assignmentId", body = body.toString()),
            ),
        )
    }

    suspend fun forPatient(patientId: String): PatientSurveys =
        decode(client.send(Endpoint(HttpMethod.GET, "patients/$patientId/surveys")))

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
