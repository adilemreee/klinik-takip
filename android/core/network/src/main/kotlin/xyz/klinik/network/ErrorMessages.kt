package xyz.klinik.network

/**
 * Maps a failure to the string key the UI shows.
 *
 * Lives here, shared by every feature, so two screens cannot describe the same
 * failure differently — which is how a user ends up being told to change a
 * password that is perfectly fine.
 */
fun ApiError.messageKey(): String = when (this) {
    is ApiError.Offline -> "error.offline"
    is ApiError.TimedOut -> "error.timedOut"
    is ApiError.NotFound -> "error.notFound"
    is ApiError.Forbidden -> "error.forbidden"

    // Outside the sign-in screen a bare 401 means the session ended, not that a
    // password was mistyped. Wrong credentials arrive as Auth(INVALID_CREDENTIALS).
    is ApiError.Unauthorized -> "error.sessionExpired"

    is ApiError.Auth -> when (code) {
        AuthErrorCode.INVALID_CREDENTIALS -> "auth.error.invalidCredentials"
        AuthErrorCode.ACCOUNT_LOCKED -> "auth.error.accountLocked"
        AuthErrorCode.ACCOUNT_INACTIVE -> "auth.error.accountInactive"
        AuthErrorCode.PASSWORD_TOO_WEAK -> "auth.error.passwordTooWeak"
        else -> "auth.error.mfaInvalid"
    }

    else -> "error.server"
}
