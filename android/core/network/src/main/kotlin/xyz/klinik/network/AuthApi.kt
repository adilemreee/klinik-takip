package xyz.klinik.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class LoginRequest(
    val identifier: String,
    val password: String,
    val totpCode: String? = null,
    val deviceName: String? = null,
    val platform: String? = "android",
)

@Serializable
data class LoginResponse(
    val status: Status,
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val expiresIn: Int? = null,
    /**
     * Present only with MFA_SETUP_REQUIRED. Accepted solely by the enrolment
     * endpoints, and expires in five minutes.
     */
    val setupToken: String? = null,
) {
    @Serializable
    enum class Status {
        @SerialName("OK") OK,
        @SerialName("MFA_REQUIRED") MFA_REQUIRED,
        @SerialName("MFA_SETUP_REQUIRED") MFA_SETUP_REQUIRED,
    }

    /** Tokens, when the response actually carries a session. */
    fun tokens(nowMillis: Long = System.currentTimeMillis()): SessionTokens? {
        val access = accessToken ?: return null
        val refresh = refreshToken ?: return null
        val expires = expiresIn ?: return null

        return SessionTokens(access, refresh, nowMillis + expires * 1000L)
    }
}

@Serializable
data class TokensResponse(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int,
) {
    fun tokens(nowMillis: Long = System.currentTimeMillis()): SessionTokens =
        SessionTokens(accessToken, refreshToken, nowMillis + expiresIn * 1000L)
}

@Serializable
data class TotpSetup(val secret: String, val uri: String)

@Serializable
private data class TotpCode(val code: String)

/**
 * Authentication calls.
 *
 * Refresh lives in SessionManager rather than here: the backend treats refresh
 * tokens as single-use, so exactly one refresh may be in flight at a time and
 * that has to be enforced in one place.
 */
class AuthApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    suspend fun login(request: LoginRequest): LoginResponse {
        val body = client.send(
            Endpoint(
                method = HttpMethod.POST,
                path = "auth/login",
                body = json.encodeToString(request),
                requiresAuthentication = false,
            ),
        )

        return decode(body)
    }

    /**
     * Starts enrolment. Reached with the scoped setup token when the account
     * has no second factor yet, or with a session token when a patient opts in.
     */
    suspend fun beginTotpEnrolment(setupToken: String? = null): TotpSetup =
        decode(
            client.send(
                Endpoint(method = HttpMethod.POST, path = "auth/2fa/setup", bearerOverride = setupToken),
            ),
        )

    suspend fun confirmTotpEnrolment(code: String, setupToken: String? = null) {
        client.send(
            Endpoint(
                method = HttpMethod.POST,
                path = "auth/2fa/confirm",
                body = json.encodeToString(TotpCode(code)),
                bearerOverride = setupToken,
            ),
        )
    }

    suspend fun signOut() {
        client.send(Endpoint(method = HttpMethod.POST, path = "auth/logout"))
    }

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
