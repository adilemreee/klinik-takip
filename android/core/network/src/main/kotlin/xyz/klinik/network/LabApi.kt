package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
enum class LabFlag {
    LOW,
    NORMAL,
    HIGH,
    CRITICAL,
    ;

    val stringKey: String get() = "lab_flag_${name.lowercase()}"
}

@Serializable
data class LabResult(
    val id: String,
    /** LOINC, where the printed name could be mapped. */
    val analyteCode: String? = null,
    val analyteName: String,
    /** Decimal on the wire, because a binary float cannot hold 0.1 exactly. */
    val value: String,
    val unit: String,
    val refLow: String? = null,
    val refHigh: String? = null,
    /** Null when the report carried no range — unclassified, not normal. */
    val flag: LabFlag? = null,
    val measuredAt: String,
    val ocrConfidence: String? = null,
    val verifiedAt: String? = null,
) {
    val referenceText: String?
        get() = when {
            refLow != null && refHigh != null -> "$refLow – $refHigh"
            refHigh != null -> "< $refHigh"
            refLow != null -> "> $refLow"
            else -> null
        }
}

@Serializable
data class LabReviewItem(
    val result: LabResult,
    /** The engine was unsure; one to look at first. */
    val needsAttention: Boolean,
    /** The printed name has no code yet. */
    val awaitingMapping: Boolean,
)

/**
 * The corrections a reviewer made. Everything is optional: confirming without
 * changing anything is the common case and must not require restating the row.
 */
@Serializable
data class LabCorrection(
    val analyteName: String? = null,
    val analyteCode: String? = null,
    val value: Double? = null,
    val unit: String? = null,
    val refLow: Double? = null,
    val refHigh: Double? = null,
)

class LabApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /** What OCR read and nobody has confirmed. Least certain first. */
    suspend fun pending(patientId: String): List<LabReviewItem> =
        decode(client.send(Endpoint(HttpMethod.GET, "patients/$patientId/lab-results/pending")))

    /** Confirmed results only — what a trend may be drawn from. */
    suspend fun verified(patientId: String, analyteCode: String? = null): List<LabResult> =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.GET,
                    "patients/$patientId/lab-results",
                    query = analyteCode?.let { mapOf("analyteCode" to it) } ?: emptyMap(),
                ),
            ),
        )

    suspend fun verify(resultId: String, correction: LabCorrection): LabResult =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.PATCH,
                    "lab-results/$resultId/verify",
                    body = json.encodeToString(LabCorrection.serializer(), correction),
                ),
            ),
        )

    /** For the table headings and page furniture OCR reads as values. */
    suspend fun discard(resultId: String) {
        client.send(Endpoint(HttpMethod.DELETE, "lab-results/$resultId"))
    }

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
