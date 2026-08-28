package xyz.klinik.network

import kotlinx.serialization.json.Json

data class ApiConfiguration(
    val baseUrl: String,
    /** Sent as Accept-Language so the backend can localise what it returns. */
    val preferredLanguage: String = "tr",
)

enum class HttpMethod { GET, POST, PATCH, PUT, DELETE }

data class Endpoint(
    val method: HttpMethod,
    val path: String,
    val query: Map<String, String> = emptyMap(),
    val body: String? = null,
    /**
     * Endpoints that must not carry a token — sign-in, refresh, invitation
     * redemption. Attaching an expired token would trigger a refresh in order
     * to call refresh, which is a loop.
     */
    val requiresAuthentication: Boolean = true,
)

/**
 * The networking layer.
 *
 * Responsibilities kept deliberately narrow: build the request, attach a valid
 * token, map failures, and retry exactly once after a 401.
 */
class ApiClient(
    private val configuration: ApiConfiguration,
    private val transport: HttpTransport,
    private val session: SessionManager,
    private val json: Json = defaultJson,
) {
    suspend fun send(endpoint: Endpoint): String = perform(endpoint, retryAfterRefresh = true).body

    private suspend fun perform(endpoint: Endpoint, retryAfterRefresh: Boolean): HttpResponse {
        val token = if (endpoint.requiresAuthentication) session.validAccessToken() else null
        val response = transport.send(buildRequest(endpoint, token))

        if (response.status in 200..299) {
            return response
        }

        // One retry, and only for a 401 on an authenticated request. Retrying
        // more would spend refresh tokens the backend treats as single-use.
        //
        // The token that failed is handed back, so a request that queued behind
        // another one's refresh does not trigger a second, pointless refresh.
        if (response.status == 401 && endpoint.requiresAuthentication && retryAfterRefresh && token != null) {
            session.refreshAfterUnauthorized(token)
            return perform(endpoint, retryAfterRefresh = false)
        }

        throw mapFailure(response)
    }

    private fun buildRequest(endpoint: Endpoint, token: String?): HttpRequest {
        val query = if (endpoint.query.isEmpty()) {
            ""
        } else {
            // Sorted so a request is reproducible — which matters for caching,
            // for logs, and for tests.
            endpoint.query.entries
                .sortedBy { it.key }
                .joinToString("&", prefix = "?") { "${encode(it.key)}=${encode(it.value)}" }
        }

        val headers = buildMap {
            put("Accept", "application/json")
            put("Accept-Language", configuration.preferredLanguage)
            if (endpoint.body != null) put("Content-Type", "application/json")
            if (token != null) put("Authorization", "Bearer $token")
        }

        return HttpRequest(
            method = endpoint.method.name,
            url = "${configuration.baseUrl.trimEnd('/')}/${endpoint.path.trimStart('/')}$query",
            headers = headers,
            body = endpoint.body,
        )
    }

    private fun mapFailure(response: HttpResponse): ApiError {
        val body = runCatching { json.decodeFromString<ErrorResponse>(response.body) }
            .getOrDefault(ErrorResponse(statusCode = response.status))

        val retryAfter = response.headers["retry-after"]?.toLongOrNull()

        return ApiError.from(response.status, body, retryAfter)
    }

    private fun encode(value: String): String =
        java.net.URLEncoder.encode(value, Charsets.UTF_8).replace("+", "%20")

    companion object {
        val defaultJson = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
        }
    }
}
