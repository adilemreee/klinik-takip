package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
private data class RefreshRequest(val refreshToken: String)

/**
 * Exchanges a refresh token for a new session.
 *
 * Goes straight to the transport rather than through [ApiClient], because the
 * client attaches a valid access token to every request and obtaining one is
 * precisely what this call is for — routing it through the client is a loop.
 *
 * Serialisation of these calls is [SessionManager]'s job, not this class's:
 * the backend issues single-use refresh tokens and revokes the whole device
 * session when a consumed one is replayed, so two of these running at once
 * signs the user out. This just performs the one call it is given.
 */
class HttpTokenRefresher(
    private val configuration: ApiConfiguration,
    private val transport: HttpTransport,
    private val json: Json = ApiClient.defaultJson,
    private val now: () -> Long = System::currentTimeMillis,
) : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens {
        val response = transport.send(
            HttpRequest(
                method = "POST",
                url = configuration.baseUrl.trimEnd('/') + "/auth/refresh",
                headers = mapOf(
                    "Content-Type" to "application/json",
                    "Accept" to "application/json",
                    "Accept-Language" to configuration.preferredLanguage,
                ),
                body = json.encodeToString(RefreshRequest(refreshToken)),
            ),
        )

        if (response.status !in 200..299) {
            val body = runCatching { json.decodeFromString<ErrorResponse>(response.body) }
                .getOrDefault(ErrorResponse(statusCode = response.status))

            throw ApiError.from(response.status, body)
        }

        return runCatching { json.decodeFromString<TokensResponse>(response.body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable refresh response") }
            .tokens(now())
    }
}
