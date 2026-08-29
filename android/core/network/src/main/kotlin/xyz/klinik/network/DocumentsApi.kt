package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
enum class DocumentType {
    LAB,
    IMAGING,
    REPORT,
    CONSENT,
    INVOICE,
    PASSPORT,
    ECG,
    OTHER,
    ;

    val stringKey: String get() = "document_type_${name.lowercase()}"
}

/**
 * Where a piece of queued work has got to.
 *
 * QUEUED covers "waiting for its first attempt" and "waiting for a retry"
 * alike, which is what the person looking at the screen needs to know: it is
 * still going to happen.
 */
@Serializable
enum class ProcessingStatus {
    PENDING,
    QUEUED,
    PROCESSING,
    DONE,
    FAILED,
    SKIPPED,
    ;

    val stringKey: String get() = "job_status_${name.lowercase()}"

    /** Whether the clinic still expects this to finish on its own. */
    val isSettled: Boolean get() = this == DONE || this == FAILED || this == SKIPPED
}

@Serializable
data class ClinicalDocument(
    val id: String,
    val type: DocumentType,
    val originalName: String? = null,
    /** Detected from the bytes at upload, not from what was declared. */
    val mime: String,
    val size: Int,
    val ocrStatus: ProcessingStatus,
    val createdAt: String,
)

@Serializable
data class DocumentPage(
    val items: List<ClinicalDocument> = emptyList(),
    /** Null on the last page. */
    val nextCursor: String? = null,
)

@Serializable
data class UploadedDocument(
    val id: String,
    val type: DocumentType,
    val originalName: String? = null,
    val mime: String,
    val size: Int,
    val ocrStatus: ProcessingStatus,
    val createdAt: String,
    /** The processing job queued for this upload. */
    val jobId: String,
)

@Serializable
data class JobRecord(
    val id: String,
    val queue: String,
    val name: String,
    val status: ProcessingStatus,
    val attempts: Int,
    /** Safe to show staff; never carries file contents. */
    val error: String? = null,
    val startedAt: String? = null,
    val finishedAt: String? = null,
    val createdAt: String,
)

@Serializable
data class DownloadLink(
    val url: String,
    val expiresAt: String,
    val filename: String,
)

class DocumentsApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    suspend fun list(
        patientId: String,
        type: DocumentType? = null,
        cursor: String? = null,
        limit: Int? = null,
    ): DocumentPage =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.GET,
                    "patients/$patientId/documents",
                    query = buildMap {
                        type?.let { put("type", it.name) }
                        cursor?.let { put("cursor", it) }
                        limit?.let { put("limit", it.toString()) }
                    },
                ),
            ),
        )

    /** Streamed from disk by the transport; nothing is held in memory. */
    suspend fun upload(
        patientId: String,
        path: String,
        filename: String,
        type: DocumentType,
        contentType: String = "application/octet-stream",
    ): UploadedDocument =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "patients/$patientId/documents",
                    multipart = MultipartUpload(
                        fields = mapOf("type" to type.name),
                        path = path,
                        filename = filename,
                        contentType = contentType,
                    ),
                ),
            ),
        )

    suspend fun jobs(documentId: String): List<JobRecord> =
        decode(client.send(Endpoint(HttpMethod.GET, "documents/$documentId/jobs")))

    /** A fresh link each time: they are short-lived and are never stored. */
    suspend fun downloadLink(documentId: String): DownloadLink =
        decode(client.send(Endpoint(HttpMethod.GET, "documents/$documentId/download")))

    suspend fun remove(documentId: String) {
        client.send(Endpoint(HttpMethod.DELETE, "documents/$documentId"))
    }

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
