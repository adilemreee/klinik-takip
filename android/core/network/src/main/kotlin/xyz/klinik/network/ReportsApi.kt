package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
enum class RiskLevel {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL,
    ;

    val stringKey: String get() = "report_risk_${name.lowercase()}"

    /** Whether a clinician's list should mark this one out. */
    val needsAttention: Boolean get() = this == HIGH || this == CRITICAL
}

/** The staff rendering: clinical text, the risk label, and who signed it off. */
@Serializable
data class AIReport(
    val id: String,
    val patientId: String,
    val source: String,
    /** Clinical rendering, for staff. */
    val contentMd: String,
    /** Plain-language rendering, for the patient. */
    val patientFacingMd: String? = null,
    val riskLevel: RiskLevel? = null,
    val model: String,
    val modelVersion: String? = null,
    val generatedAt: String,
    val reviewedById: String? = null,
    val reviewedAt: String? = null,
    val releasedToPatientAt: String? = null,
)

@Serializable
data class ReportView(
    val report: AIReport,
    /** The warning that goes under every AI output (spec M5). */
    val disclaimer: String,
    val visibleToPatient: Boolean = false,
) {
    val isReviewed: Boolean get() = report.reviewedAt != null
}

/**
 * What the patient is given, which is a different document.
 *
 * There is no clinical text on it and no risk label — "CRITICAL" on a patient's
 * screen, with no clinician attached to it, is a verdict, and the server does
 * not send one.
 */
@Serializable
data class PatientReport(
    val id: String,
    val source: String,
    val contentMd: String,
    val generatedAt: String,
    val releasedAt: String,
    val disclaimer: String,
)

@Serializable
private data class ReviewBody(val release: Boolean)

class ReportsApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /** Only what a clinician released. The filter is the server's, not ours. */
    suspend fun mine(): List<PatientReport> =
        decode(client.send(Endpoint(HttpMethod.GET, "me/reports")))

    suspend fun pending(): List<ReportView> =
        decode(client.send(Endpoint(HttpMethod.GET, "reports/pending")))

    suspend fun forPatient(patientId: String): List<ReportView> =
        decode(client.send(Endpoint(HttpMethod.GET, "patients/$patientId/reports")))

    suspend fun interpretLabs(patientId: String, documentId: String? = null): ReportView =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "patients/$patientId/reports/lab",
                    query = documentId?.let { mapOf("documentId" to it) } ?: emptyMap(),
                ),
            ),
        )

    /** Signing off, and deciding in the same action whether the patient sees it. */
    suspend fun review(reportId: String, release: Boolean): ReportView =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.PATCH,
                    "reports/$reportId/review",
                    body = json.encodeToString(ReviewBody.serializer(), ReviewBody(release)),
                ),
            ),
        )

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
