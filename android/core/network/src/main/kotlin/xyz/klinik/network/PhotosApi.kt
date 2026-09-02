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
) {
    val hasUsageConsent: Boolean get() = consentId != null
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
    suspend fun gallery(
        patientId: String,
        category: PhotoCategory? = null,
        bodyArea: String? = null,
    ): List<GalleryGroup> =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.GET,
                    "patients/$patientId/photos",
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
    suspend fun overlayReference(patientId: String, bodyArea: String): ClinicalPhoto? {
        val body = client.send(
            Endpoint(
                HttpMethod.GET,
                "patients/$patientId/photos/overlay",
                query = mapOf("bodyArea" to bodyArea),
            ),
        )

        return runCatching { json.decodeFromString<ClinicalPhoto>(body) }.getOrNull()
    }

    /** A fresh link each time: they are short-lived and are never stored. */
    suspend fun link(photoId: String): PhotoLink =
        decode(client.send(Endpoint(HttpMethod.GET, "photos/$photoId/url")))

    suspend fun upload(
        patientId: String,
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
                    "patients/$patientId/photos",
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
