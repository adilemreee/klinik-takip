package xyz.klinik.network

data class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    val body: String? = null,
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
