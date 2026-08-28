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

/**
 * Text destined for a screen, which is either ours or the server's.
 *
 * Most failures map to a key in the string catalogue. A few — a refused
 * measurement, a rejected password — are described better by the server, which
 * localises by Accept-Language and knows the specific bound that was crossed.
 * Collapsing both into a key would replace "Weight must be between 20 and 400
 * kg" with "something went wrong", which tells the nurse nothing about what to
 * fix.
 */
sealed interface UiText {
    /** A key into the string catalogue. */
    data class Key(val key: String) : UiText

    /** Text the server supplied, already in the caller's language. */
    data class Literal(val text: String) : UiText
}

/**
 * The message for a failure: the server's own words where it has them, our
 * catalogue key otherwise.
 */
fun ApiError.uiText(): UiText {
    val fromServer = when (this) {
        is ApiError.Validation -> body.message
        is ApiError.Conflict -> body.message
        else -> ""
    }

    return if (fromServer.isNotEmpty()) UiText.Literal(fromServer) else UiText.Key(messageKey())
}
