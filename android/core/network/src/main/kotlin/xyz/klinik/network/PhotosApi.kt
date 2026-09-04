package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
enum class PhotoCategory {
    BEFORE,
    AFTER,
    COMPLICATION,
    WOUND,
    ;

    val stringKey: String get() = "photo_category_${name.lowercase()}"
}

@Serializable
data class ClinicalPhoto(
    val id: String,
    val category: PhotoCategory,
    val bodyArea: String? = null,
    /** Free text: milestones differ per procedure (pre-op, post-op D1, W2, M1…). */
    val phaseLabel: String? = null,
    val mime: String,
    val size: Int,
    val takenAt: String,
    /** Location metadata was removed before the image was stored. */
    val exifStripped: Boolean = false,
    val isFaceBlurred: Boolean = false,
    /** Without a photo-usage consent the image is clinical-use only. */
    val consentId: String? = null,
    val note: String? = null,
    /**
     * AI pre-assessment (spec M5). Null means nobody has looked.
     *
     * A **flag**, never a diagnosis, and never shown to a patient — the photo
     * endpoints require `photos.read`, which no patient holds.
     */
    val aiReviewSuggested: Boolean? = null,
    /** What was observed, from a closed vocabulary. Never a condition name. */
    val aiFindings: List<String> = emptyList(),
    val aiAssessedAt: String? = null,
) {
    val hasUsageConsent: Boolean get() = consentId != null

    /** Somebody looked and found nothing, as opposed to nobody having looked. */
    val isAssessedClean: Boolean get() = aiReviewSuggested == false
    val needsReview: Boolean get() = aiReviewSuggested == true

    fun findingKeys(): List<String> = aiFindings.map { "photo_finding_${it.replace('-', '_')}" }
}

/** Why nothing was assessed, when nothing was. */
@Serializable
enum class AssessmentSkip {
    /** The clinic has not switched photo assessment on. */
    @kotlinx.serialization.SerialName("disabled")
    DISABLED,

    @kotlinx.serialization.SerialName("unsupported-image")
    UNSUPPORTED_IMAGE,

    @kotlinx.serialization.SerialName("ai-unavailable")
    AI_UNAVAILABLE,

    /** The answer could not be read, so the photo is left exactly as it was. */
    @kotlinx.serialization.SerialName("unreadable")
    UNREADABLE,
}

@Serializable
data class PhotoAssessment(
    val photo: ClinicalPhoto,
    /** From a closed vocabulary. A word outside it is dropped, not passed through. */
    val findings: List<String> = emptyList(),
    /** Any finding at all means a clinician should look. */
    val reviewSuggested: Boolean = false,
    val model: String? = null,
    val skippedReason: AssessmentSkip? = null,
) {
    val wasAssessed: Boolean get() = skippedReason == null
}

@Serializable
data class GalleryGroup(
    val bodyArea: String? = null,
    /** Oldest first: a progression reads forwards. */
    val photos: List<ClinicalPhoto> = emptyList(),
) {
    val id: String get() = bodyArea ?: ""
}

@Serializable
data class PhotoLink(val url: String, val expiresAt: String)

class PhotosApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /**
     * Photos the pre-assessment flagged, oldest first.
     *
     * A worklist: ordered newest-first it would be one where the oldest thing
     * waits forever.
     */
    suspend fun flagged(): List<ClinicalPhoto> =
        decode(client.send(Endpoint(HttpMethod.GET, "photos/flagged")))

    /** Asks for a pre-assessment. Sends a clinical photograph to a third party. */
    suspend fun assess(photoId: String): PhotoAssessment =
        decode(client.send(Endpoint(HttpMethod.POST, "photos/$photoId/assess")))

    suspend fun gallery(
        subject: RecordSubject,
        category: PhotoCategory? = null,
        bodyArea: String? = null,
    ): List<GalleryGroup> =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.GET,
                    subject.base("photos"),
                    query = buildMap {
                        category?.let { put("category", it.name) }
                        bodyArea?.let { put("bodyArea", it) }
                    },
                ),
            ),
        )

    /**
     * The photo a new capture should be lined up against.
     *
     * The endpoint answers with an empty object when there is nothing to line
     * up against, which is not the same as a missing field or a failure.
     */
    suspend fun overlayReference(subject: RecordSubject, bodyArea: String): ClinicalPhoto? {
        val body = client.send(
            Endpoint(
                HttpMethod.GET,
                subject.base("photos/overlay"),
                query = mapOf("bodyArea" to bodyArea),
            ),
        )

        return runCatching { json.decodeFromString<ClinicalPhoto>(body) }.getOrNull()
    }

    /** A fresh link each time: they are short-lived and are never stored. */
    suspend fun link(photoId: String): PhotoLink =
        decode(client.send(Endpoint(HttpMethod.GET, "photos/$photoId/url")))

    suspend fun upload(
        subject: RecordSubject,
        path: String,
        filename: String,
        category: PhotoCategory,
        bodyArea: String? = null,
        phaseLabel: String? = null,
        note: String? = null,
        consentId: String? = null,
    ): ClinicalPhoto =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    subject.base("photos"),
                    multipart = MultipartUpload(
                        fields = buildMap {
                            put("category", category.name)
                            bodyArea?.let { put("bodyArea", it) }
                            phaseLabel?.let { put("phaseLabel", it) }
                            note?.let { put("note", it) }
                            consentId?.let { put("consentId", it) }
                        },
                        path = path,
                        filename = filename,
                        contentType = "image/jpeg",
                    ),
                ),
            ),
        )

    suspend fun remove(photoId: String) {
        client.send(Endpoint(HttpMethod.DELETE, "photos/$photoId"))
    }

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
