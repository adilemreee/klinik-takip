package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
enum class ComplicationStatus {
    REPORTED,
    ACKNOWLEDGED,
    RESOLVED,
    ;

    val stringKey: String get() = "complication_status_${name.lowercase()}"
}

@Serializable
data class Complication(
    val id: String,
    val patientId: String,
    val status: ComplicationStatus,
    /** What the patient said, in their own words. */
    val note: String,
    val bodyArea: String? = null,
    val reportedAt: String,
    val acknowledgedAt: String? = null,
    /** What the clinician answered. */
    val firstResponse: String? = null,
    val resolvedAt: String? = null,
    val resolution: String? = null,
)

@Serializable
data class ComplicationView(
    val complication: Complication,
    val photos: List<ClinicalPhoto> = emptyList(),
    /** Minutes from report to first answer, or to now while still waiting. */
    val waitingMinutes: Int,
    /** Null until someone answered. */
    val responseMinutes: Int? = null,
    /** Still unanswered past the clinic threshold. */
    val overdue: Boolean = false,
)

@Serializable
private data class ReportBody(
    val note: String,
    val bodyArea: String? = null,
    val photoIds: List<String> = emptyList(),
)

@Serializable
private data class RespondBody(val message: String)

class ComplicationsApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    // Patient side

    suspend fun report(
        note: String,
        bodyArea: String? = null,
        photoIds: List<String> = emptyList(),
    ): ComplicationView =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "me/complications",
                    body = json.encodeToString(
                        ReportBody.serializer(),
                        ReportBody(note, bodyArea, photoIds),
                    ),
                ),
            ),
        )

    suspend fun mine(): List<ComplicationView> =
        decode(client.send(Endpoint(HttpMethod.GET, "me/complications")))

    // Clinician side

    suspend fun queue(includeResolved: Boolean = false): List<ComplicationView> =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.GET,
                    "complications",
                    query = if (includeResolved) mapOf("includeResolved" to "true") else emptyMap(),
                ),
            ),
        )

    suspend fun acknowledge(id: String, message: String): ComplicationView =
        respond("complications/$id/acknowledge", message)

    suspend fun resolve(id: String, message: String): ComplicationView =
        respond("complications/$id/resolve", message)

    private suspend fun respond(path: String, message: String): ComplicationView =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.PATCH,
                    path,
                    body = json.encodeToString(RespondBody.serializer(), RespondBody(message)),
                ),
            ),
        )

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
