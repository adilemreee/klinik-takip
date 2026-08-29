package xyz.klinik.network

data class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    val body: String? = null,
    /**
     * A file to send as a multipart body.
     *
     * Described rather than pre-built: a clinical document can be 20 MB, and
     * assembling that envelope in a String — on top of whatever the camera or
     * picker is already holding — is how an upload screen gets killed by the
     * system just as the patient finally sends the scan. The transport
     * implementation streams it from disk.
     */
    val multipart: MultipartUpload? = null,
)

/** A file part plus the text fields that accompany it. */
data class MultipartUpload(
    val fields: Map<String, String> = emptyMap(),
    val fieldName: String = "file",
    /** Absolute path on the device. */
    val path: String,
    val filename: String,
    val contentType: String = "application/octet-stream",
)

data class HttpResponse(
    val status: Int,
    val body: String,
    val headers: Map<String, String> = emptyMap(),
)

/**
 * The one place the client touches the network.
 *
 * Behind an interface so every layer above it — retries, refresh, error
 * mapping — is tested against recorded responses instead of a live server, and
 * so the engine (OkHttp, Ktor) is an implementation detail rather than a
 * dependency of the logic.
 */
fun interface HttpTransport {
    suspend fun send(request: HttpRequest): HttpResponse
}
