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

/**
 * A device holding a session.
 *
 * `familyId` is what gets revoked: the server rotates refresh tokens and keeps
 * a family per sign-in, so ending one here ends that device rather than that
 * one token.
 */
@Serializable
data class SessionSummary(
    val familyId: String,
    val deviceName: String? = null,
    val platform: String? = null,
    val ipAddress: String? = null,
    val lastSeenAt: String,
    /** True for the device making this request. */
    val current: Boolean = false,
)

/**
 * An invitation, returned once.
 *
 * The code is shown exactly once because only its hash is stored — a screen
 * that expects to fetch it again later will show somebody a blank instead.
 */
@Serializable
data class Invitation(
    val id: String,
    val code: String,
    val expiresAt: String,
)

@Serializable
private data class ChangePasswordBody(val currentPassword: String, val newPassword: String)

@Serializable
private data class AcceptInvitationBody(
    val identifier: String,
    val code: String,
    val password: String,
)

@Serializable
private data class CreateInvitationBody(
    val email: String? = null,
    val phone: String? = null,
    val role: UserRole,
    val patientId: String? = null,
)

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

    /**
     * Turns two-factor off, with a current code.
     *
     * The code is required by the server and asked for here: somebody who has
     * walked away from an unlocked phone should not be able to remove the
     * second factor from the account they left open.
     */
    suspend fun disableTotp(code: String) {
        client.send(
            Endpoint(
                method = HttpMethod.POST,
                path = "auth/2fa/disable",
                body = json.encodeToString(TotpCode(code)),
            ),
        )
    }

    /** Changing a password. The current one is required; the server checks it. */
    suspend fun changePassword(currentPassword: String, newPassword: String) {
        client.send(
            Endpoint(
                method = HttpMethod.POST,
                path = "auth/password",
                body = json.encodeToString(
                    ChangePasswordBody.serializer(),
                    ChangePasswordBody(currentPassword, newPassword),
                ),
            ),
        )
    }

    /** Every device holding a session, with this one marked. */
    suspend fun sessions(): List<SessionSummary> =
        decode(client.send(Endpoint(method = HttpMethod.GET, path = "auth/sessions")))

    /** Ends one device's session. */
    suspend fun endSession(familyId: String) {
        client.send(Endpoint(method = HttpMethod.DELETE, path = "auth/sessions/$familyId"))
    }

    /** Ends every session, including this one. */
    suspend fun signOutEverywhere() {
        client.send(Endpoint(method = HttpMethod.POST, path = "auth/logout-all"))
    }

    /**
     * Invites somebody. The code comes back once and is delivered by the
     * clinic — the server keeps only its hash.
     */
    suspend fun invite(
        role: UserRole,
        email: String? = null,
        phone: String? = null,
        patientId: String? = null,
    ): Invitation =
        decode(
            client.send(
                Endpoint(
                    method = HttpMethod.POST,
                    path = "auth/invitations",
                    body = json.encodeToString(
                        CreateInvitationBody.serializer(),
                        CreateInvitationBody(email, phone, role, patientId),
                    ),
                ),
            ),
        )

    /** Redeems an invitation and signs the new account in. */
    suspend fun acceptInvitation(
        identifier: String,
        code: String,
        password: String,
    ): LoginResponse =
        decode(
            client.send(
                Endpoint(
                    method = HttpMethod.POST,
                    path = "auth/invitations/accept",
                    body = json.encodeToString(
                        AcceptInvitationBody.serializer(),
                        AcceptInvitationBody(identifier, code, password),
                    ),
                ),
            ),
        )

    suspend fun signOut() {
        client.send(Endpoint(method = HttpMethod.POST, path = "auth/logout"))
    }

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
