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
    /** A raw binary body — one chunk of a resumable upload. */
    val bytes: ByteArray? = null,
) {
    // ByteArray has identity equality, which would make two requests carrying
    // the same chunk compare unequal and quietly break any test that compares
    // requests.
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is HttpRequest) return false

        return method == other.method &&
            url == other.url &&
            headers == other.headers &&
            body == other.body &&
            multipart == other.multipart &&
            bytes.contentEquals(other.bytes)
    }

    override fun hashCode(): Int {
        var result = method.hashCode()
        result = 31 * result + url.hashCode()
        result = 31 * result + headers.hashCode()
        result = 31 * result + (body?.hashCode() ?: 0)
        result = 31 * result + (multipart?.hashCode() ?: 0)
        result = 31 * result + (bytes?.contentHashCode() ?: 0)
        return result
    }
}

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
