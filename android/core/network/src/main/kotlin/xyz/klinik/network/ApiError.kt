package xyz.klinik.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive

/** The error body every backend failure uses. */
@Serializable
data class ErrorResponse(
    @SerialName("statusCode") val statusCode: Int = 0,
    @SerialName("message") private val rawMessage: JsonElement? = null,
    @SerialName("error") val error: String? = null,
) {
    /**
     * Validation failures arrive as an array of messages and everything else as
     * a single string; both reach the UI as one field.
     */
    val message: String
        get() = when (val element = rawMessage) {
            null -> ""
            is JsonPrimitive -> element.content
            else -> runCatching {
                element.jsonArray.joinToString("\n") { it.jsonPrimitive.content }
            }.getOrDefault("")
        }
}

/** Machine-readable codes the backend returns on the authentication path. */
enum class AuthErrorCode(val code: String) {
    INVALID_CREDENTIALS("INVALID_CREDENTIALS"),
    ACCOUNT_LOCKED("ACCOUNT_LOCKED"),
    ACCOUNT_INACTIVE("ACCOUNT_INACTIVE"),
    MFA_REQUIRED("MFA_REQUIRED"),
    MFA_INVALID("MFA_INVALID"),
    MFA_SETUP_REQUIRED("MFA_SETUP_REQUIRED"),
    INVITATION_INVALID("INVITATION_INVALID"),
    INVITATION_EXPIRED("INVITATION_EXPIRED"),
    INVITATION_ATTEMPTS_EXCEEDED("INVITATION_ATTEMPTS_EXCEEDED"),
    PASSWORD_TOO_WEAK("PASSWORD_TOO_WEAK"),
    ;

    companion object {
        fun from(value: String): AuthErrorCode? = entries.firstOrNull { it.code == value }
    }
}

sealed class ApiError(message: String? = null) : Exception(message) {
    /**
     * No usable connection. Distinct from a server failure because the UI
     * offers a different remedy (spec M15: the offline indicator).
     */
    data object Offline : ApiError("offline")
    data object TimedOut : ApiError("timed out")

    /** A recognised authentication outcome; the UI branches on the code. */
    data class Auth(val code: AuthErrorCode, val body: ErrorResponse) : ApiError(code.code)

    data class Unauthorized(val body: ErrorResponse) : ApiError("unauthorized")
    data class Forbidden(val body: ErrorResponse) : ApiError("forbidden")

    /**
     * Also returned for a record outside the caller's scope — the backend makes
     * the two indistinguishable on purpose, so the client must not tell the
     * user the record exists.
     */
    data class NotFound(val body: ErrorResponse) : ApiError("not found")

    data class Validation(val body: ErrorResponse) : ApiError("validation")
    data class Conflict(val body: ErrorResponse) : ApiError("conflict")
    data class RateLimited(val retryAfterSeconds: Long?) : ApiError("rate limited")
    data class Server(val body: ErrorResponse) : ApiError("server")
    data class Decoding(val detail: String) : ApiError("decoding")
    data class Unknown(val status: Int) : ApiError("unknown")

    /** Whether retrying the same request unchanged could plausibly succeed. */
    val isRetryable: Boolean
        get() = this is Offline || this is TimedOut || this is RateLimited || this is Server

    /** Whether the session is over and the user has to sign in again. */
    val requiresReauthentication: Boolean
        get() = when (this) {
            is Unauthorized -> true
            is Auth -> code == AuthErrorCode.ACCOUNT_INACTIVE || code == AuthErrorCode.ACCOUNT_LOCKED
            else -> false
        }

    companion object {
        /** Maps a response to the case the UI branches on. */
        fun from(status: Int, body: ErrorResponse, retryAfterSeconds: Long? = null): ApiError {
            AuthErrorCode.from(body.message)?.let { return Auth(it, body) }

            return when (status) {
                400, 422 -> Validation(body)
                401 -> Unauthorized(body)
                403 -> Forbidden(body)
                404 -> NotFound(body)
                409 -> Conflict(body)
                429 -> RateLimited(retryAfterSeconds)
                in 500..599 -> Server(body)
                else -> Unknown(status)
            }
        }
    }
}
