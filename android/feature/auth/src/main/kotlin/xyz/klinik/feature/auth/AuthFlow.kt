package xyz.klinik.feature.auth

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import xyz.klinik.network.ApiError
import xyz.klinik.network.AuthApi
import xyz.klinik.network.AuthErrorCode
import xyz.klinik.network.messageKey
import xyz.klinik.network.LoginRequest
import xyz.klinik.network.LoginResponse
import xyz.klinik.network.SessionManager

/**
 * Where the user is in signing in.
 *
 * One value rather than a set of booleans: isLoading, needsCode and needsSetup
 * as separate flags allow combinations that cannot happen, and every screen
 * then has to defend against them.
 */
sealed interface AuthStep {
    data object Credentials : AuthStep

    /** The account already has a second factor; it needs this login's code. */
    data object TwoFactorCode : AuthStep

    /**
     * Staff without a second factor yet. Carries what the client must show to
     * enrol one.
     */
    data class TwoFactorSetup(val secret: String, val otpauthUri: String) : AuthStep

    data object SignedIn : AuthStep
}

data class AuthState(
    val step: AuthStep = AuthStep.Credentials,
    val isSubmitting: Boolean = false,
    /** Already resolved to a message key; the view renders it. */
    val errorKey: String? = null,
    /**
     * Set while the account is locked out, so the screen can explain the wait
     * rather than repeating "wrong password".
     */
    val isLockedOut: Boolean = false,
)

/**
 * Drives sign-in and two-factor enrolment.
 *
 * Holds no Android types, so the whole flow is testable without a device.
 */
class AuthFlowModel(
    private val auth: AuthApi,
    private val session: SessionManager,
) {
    private val mutex = Mutex()
    private val _state = MutableStateFlow(AuthState())
    val state: StateFlow<AuthState> = _state.asStateFlow()

    /**
     * The scoped token returned with MFA_SETUP_REQUIRED. Never persisted: it
     * lives five minutes and may only reach the enrolment endpoints.
     */
    private var setupToken: String? = null

    /** Kept between the password step and the code step so the user does not
     *  retype them for the second factor. */
    private var pendingIdentifier: String? = null
    private var pendingPassword: String? = null

    suspend fun submitCredentials(identifier: String, password: String, deviceName: String? = null) {
        submit(
            before = {
                pendingIdentifier = identifier
                pendingPassword = password
            },
        ) {
            apply(auth.login(LoginRequest(identifier, password, deviceName = deviceName)))
        }
    }

    suspend fun submitTwoFactorCode(code: String) {
        val identifier = pendingIdentifier
        val password = pendingPassword

        if (identifier == null || password == null) {
            // Reaching here without credentials means the flow was restarted;
            // sending the user back beats a silent failure.
            reset()
            return
        }

        submit { apply(auth.login(LoginRequest(identifier, password, totpCode = code))) }
    }

    /**
     * Confirms enrolment, then sends the user to the code step.
     *
     * Two codes are involved on purpose: the enrolment code proves the
     * authenticator was set up, and the sign-in that follows is a normal login.
     * Reusing the first would fail — the backend refuses a TOTP code twice.
     */
    suspend fun confirmTwoFactorSetup(code: String) {
        val token = setupToken
        if (token == null) {
            reset()
            return
        }

        submit {
            auth.confirmTotpEnrolment(code, token)
            setupToken = null
            _state.update { it.copy(step = AuthStep.TwoFactorCode) }
        }
    }

    fun reset() {
        setupToken = null
        pendingIdentifier = null
        pendingPassword = null
        _state.value = AuthState()
    }

    private suspend fun submit(before: () -> Unit = {}, block: suspend () -> Unit) {
        // Serialised so a double tap cannot start two sign-ins, which on the
        // 2FA path would burn a code the user then has to wait to replace.
        mutex.withLock {
            if (_state.value.isSubmitting) return

            _state.update { it.copy(isSubmitting = true, errorKey = null, isLockedOut = false) }
            before()

            try {
                block()
            } catch (error: Throwable) {
                handle(error)
            } finally {
                _state.update { it.copy(isSubmitting = false) }
            }
        }
    }

    private suspend fun apply(response: LoginResponse) {
        when (response.status) {
            LoginResponse.Status.OK -> {
                val tokens = response.tokens()
                if (tokens == null) {
                    _state.update { it.copy(errorKey = "error.server") }
                    return
                }

                session.signIn(tokens)
                pendingIdentifier = null
                pendingPassword = null
                _state.update { it.copy(step = AuthStep.SignedIn) }
            }

            LoginResponse.Status.MFA_REQUIRED ->
                _state.update { it.copy(step = AuthStep.TwoFactorCode) }

            LoginResponse.Status.MFA_SETUP_REQUIRED -> {
                val token = response.setupToken
                if (token == null) {
                    _state.update { it.copy(errorKey = "error.server") }
                    return
                }

                setupToken = token
                val setup = auth.beginTotpEnrolment(token)
                _state.update { it.copy(step = AuthStep.TwoFactorSetup(setup.secret, setup.uri)) }
            }
        }
    }

    private fun handle(error: Throwable) {
        val apiError = error as? ApiError
        val key = apiError?.messageKey() ?: "error.server"

        // A locked account is not a typo; the screen says something else.
        val locked = apiError is ApiError.Auth && apiError.code == AuthErrorCode.ACCOUNT_LOCKED

        _state.update { it.copy(errorKey = key, isLockedOut = locked) }
    }
}
