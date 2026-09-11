package xyz.klinik.feature.account

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.AuthApi
import xyz.klinik.network.DataExport
import xyz.klinik.network.Identity
import xyz.klinik.network.MeApi
import xyz.klinik.network.SessionSummary
import xyz.klinik.network.UiText
import xyz.klinik.network.UserRole
import xyz.klinik.network.uiText
import xyz.klinik.shell.PasswordRules

sealed interface AccountPhase {
    data object Loading : AccountPhase
    data object Loaded : AccountPhase
    data class Failed(val message: UiText) : AccountPhase
}

/** What the account screen has just done, so it can say so. */
sealed interface AccountOutcome {
    /** Every device was signed out, including this one. */
    data object PasswordChanged : AccountOutcome
    data object TwoFactorDisabled : AccountOutcome
    data class Exported(val export: DataExport, val json: String) : AccountOutcome
}

data class AccountState(
    val phase: AccountPhase = AccountPhase.Loading,
    val identity: Identity? = null,
    val sessions: List<SessionSummary> = emptyList(),
    val busy: Boolean = false,
    val outcome: AccountOutcome? = null,
    val error: UiText? = null,
) {
    val currentSession: SessionSummary? get() = sessions.firstOrNull { it.current }
    val otherSessions: List<SessionSummary> get() = sessions.filterNot { it.current }

    /**
     * Whether this account may turn the second factor off.
     *
     * Clinic staff may not: the server refuses it, and offering a switch that
     * always fails is worse than not offering one. A patient's own account is
     * theirs to decide about.
     */
    val canDisableTwoFactor: Boolean
        get() = identity?.role == UserRole.PATIENT || identity?.role == UserRole.CAREGIVER
}

/**
 * The account somebody signed in with (spec T7.3).
 *
 * Three things live here and they are all irreversible in the same way:
 * changing a password ends every session, turning off the second factor
 * weakens the account, and a data export puts the whole record in a file the
 * patient then carries. Each one says what it will do before it does it, and
 * none of them happens without the thing that proves it was this person — the
 * current password, or a current code.
 */
class AccountModel(
    private val auth: AuthApi,
    private val me: MeApi,
) {
    private val _state = MutableStateFlow(AccountState())
    val state: StateFlow<AccountState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = AccountPhase.Loading)

        try {
            val identity = me.identity()
            // Allowed to fail on its own: an account screen that will not open
            // because the session list is unavailable is an account screen
            // somebody cannot change their password on.
            val sessions = runCatching { auth.sessions() }.getOrDefault(emptyList())

            _state.value = AccountState(
                phase = AccountPhase.Loaded,
                identity = identity,
                sessions = sessions,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(phase = AccountPhase.Failed(messageFor(error)))
        }
    }

    fun clearOutcome() {
        _state.value = _state.value.copy(outcome = null, error = null)
    }

    /**
     * What the form should say about a password before it is submitted.
     *
     * No identifier: `me/identity` returns a display name, not the e-mail or
     * phone the account signs in with, and checking the password against a
     * name would refuse ones the server accepts. The server still applies that
     * rule — it knows the identifier — so this is a subset on purpose.
     */
    fun problems(password: String): List<PasswordRules.Problem> =
        PasswordRules.problems(password)

    /**
     * Changes the password.
     *
     * The server ends every session on success — including this one — so the
     * outcome is reported rather than the screen being refreshed: there is
     * nothing left to refresh with.
     */
    suspend fun changePassword(current: String, next: String): Boolean {
        if (!PasswordRules.looksAcceptable(next)) return false

        _state.value = _state.value.copy(busy = true, error = null, outcome = null)

        return try {
            auth.changePassword(current, next)

            _state.value = _state.value.copy(
                busy = false,
                outcome = AccountOutcome.PasswordChanged,
            )

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busy = false, error = messageFor(error))
            false
        }
    }

    /**
     * Turns the second factor off, with a current code.
     *
     * The code is the point: somebody who walked away from an unlocked phone
     * should not be able to remove the second factor from the account they
     * left open.
     */
    suspend fun disableTwoFactor(code: String): Boolean {
        if (!_state.value.canDisableTwoFactor) return false

        _state.value = _state.value.copy(busy = true, error = null, outcome = null)

        return try {
            auth.disableTotp(code)

            _state.value = _state.value.copy(
                busy = false,
                outcome = AccountOutcome.TwoFactorDisabled,
            )

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busy = false, error = messageFor(error))
            false
        }
    }

    /** Ends one device's session, and takes it off the list. */
    suspend fun endSession(familyId: String): Boolean {
        _state.value = _state.value.copy(busy = true, error = null)

        return try {
            auth.endSession(familyId)

            _state.value = _state.value.copy(
                sessions = _state.value.sessions.filterNot { it.familyId == familyId },
                busy = false,
            )

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busy = false, error = messageFor(error))
            false
        }
    }

    suspend fun signOutEverywhere(): Boolean {
        _state.value = _state.value.copy(busy = true, error = null)

        return try {
            auth.signOutEverywhere()
            _state.value = _state.value.copy(busy = false)
            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busy = false, error = messageFor(error))
            false
        }
    }

    /**
     * Everything the clinic holds, as a file.
     *
     * The parsed copy is for the screen — how many rows, and what the server
     * says it left out — and the raw text is what gets written: re-encoding a
     * portability file through a client's own model is how a field nobody
     * modelled goes missing from a document meant to be complete.
     */
    suspend fun export(): Boolean {
        _state.value = _state.value.copy(busy = true, error = null, outcome = null)

        return try {
            val json = me.dataExportJson()
            val export = me.dataExport()

            _state.value = _state.value.copy(
                busy = false,
                outcome = AccountOutcome.Exported(export, json),
            )

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busy = false, error = messageFor(error))
            false
        }
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
