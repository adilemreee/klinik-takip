package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Files that leave the building (spec M12, T6.5).
 *
 * An export is a request, not a download: it is produced on a queue, the app
 * polls or waits for the notification, and the link handed out afterwards is
 * short-lived and signed. The two things a screen must not get wrong are made
 * hard here: a file that expired on schedule is not one that failed, and an
 * export with omissions is not a complete report.
 */

@Serializable
enum class ExportStatus {
    QUEUED,
    PROCESSING,
    DONE,
    FAILED,
    ;

    val stringKey: String get() = "export_status_${name.lowercase()}"

    /** Whether the app should keep asking. */
    val isPending: Boolean get() = this == QUEUED || this == PROCESSING
}

@Serializable
enum class ExportKind {
    PATIENT_SUMMARY,
}

/** Something deliberately left out of a report, and why. */
@Serializable
data class ExportOmission(
    val section: String,
    val reason: String,
    val count: Int = 0,
) {
    /** Resource key for the sentence; `{count}` is substituted by the caller. */
    val stringKey: String get() = "export_omission_${reason.replace('-', '_')}"
}

@Serializable
data class ExportContents(
    val surgeries: Int = 0,
    val measurementSeries: Int = 0,
    val labs: Int = 0,
    val medications: Int = 0,
    val photos: Int = 0,
    val aiReports: Int = 0,
    val omissions: List<ExportOmission> = emptyList(),
) {
    /** A report with omissions is not a complete one. */
    val isComplete: Boolean get() = omissions.isEmpty()
}

@Serializable
data class ExportRequest(
    val id: String,
    val kind: ExportKind,
    val status: ExportStatus,
    val patientId: String? = null,
    val size: Int? = null,
    /** What went in, and what was left out. Null until the file is finished. */
    val contents: ExportContents? = null,
    val error: String? = null,
    /** After this the stored file is deleted; the record of it stays. */
    val expiresAt: String? = null,
    val createdAt: String? = null,
) {
    /**
     * Expired is not failed.
     *
     * A file produced, delivered and cleaned up on schedule is a success, and
     * showing it as an error sends somebody looking for a fault that is not
     * there.
     */
    fun hasExpired(nowIso: String): Boolean {
        val expiry = expiresAt ?: return false

        return status == ExportStatus.DONE && expiry < nowIso
    }

    fun isReady(nowIso: String): Boolean = status == ExportStatus.DONE && !hasExpired(nowIso)
}

@Serializable
data class ExportDownload(
    val url: String,
    val expiresAt: String,
    val filename: String,
) {
    fun isStillValid(nowIso: String): Boolean = expiresAt > nowIso
}

@Serializable
private data class RequestSummaryBody(val includePhotos: Boolean)

class ExportsApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /** Asks for a patient summary. Photographs are off unless asked for. */
    suspend fun requestSummary(patientId: String, includePhotos: Boolean = false): ExportRequest =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "patients/$patientId/exports/summary",
                    body = json.encodeToString(
                        RequestSummaryBody.serializer(),
                        RequestSummaryBody(includePhotos),
                    ),
                ),
            ),
        )

    suspend fun mine(): List<ExportRequest> =
        decode(client.send(Endpoint(HttpMethod.GET, "exports")))

    suspend fun status(id: String): ExportRequest =
        decode(client.send(Endpoint(HttpMethod.GET, "exports/$id")))

    /** A short-lived signed link. Requesting one is recorded in the audit log. */
    suspend fun download(id: String): ExportDownload =
        decode(client.send(Endpoint(HttpMethod.POST, "exports/$id/download")))

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
