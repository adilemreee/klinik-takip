package xyz.klinik.feature.patients

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.AuthApi
import xyz.klinik.network.Invitation
import xyz.klinik.network.UiText
import xyz.klinik.network.UserRole
import xyz.klinik.network.uiText

/** Why an invitation would be refused, before it is sent. */
sealed interface InviteProblem {
    data object NoContact : InviteProblem
    data object BadEmail : InviteProblem

    val stringKey: String
        get() = when (this) {
            NoContact -> "invite.needContact"
            BadEmail -> "invite.badEmail"
        }
}

data class InviteState(
    val email: String = "",
    val phone: String = "",
    val busy: Boolean = false,
    /**
     * The code, shown exactly once.
     *
     * Only its hash is stored, so a screen that expected to fetch it again
     * would show somebody a blank where the code should be — and the patient
     * would never get in.
     */
    val issued: Invitation? = null,
    val error: UiText? = null,
) {
    val problems: List<InviteProblem>
        get() = buildList {
            if (email.isBlank() && phone.isBlank()) add(InviteProblem.NoContact)

            // Only checked when there is one: an invitation by phone alone is
            // ordinary, and complaining about an empty e-mail box would be
            // complaining about a field nobody filled in.
            if (email.isNotBlank() && !email.contains("@")) add(InviteProblem.BadEmail)
        }

    val canSubmit: Boolean get() = problems.isEmpty() && !busy && issued == null
}

/**
 * Inviting a patient into the app (spec T7.3).
 *
 * The clinic delivers the code itself — by the channel it already uses to talk
 * to this person — because the server returns it once and stores only its
 * hash. That is why the screen says so before the code appears and keeps it on
 * screen until somebody dismisses it: a code scrolled away by a refresh is a
 * patient who cannot sign in and a clinic that has to issue another.
 */
class InviteModel(
    private val auth: AuthApi,
    private val patientId: String,
) {
    private val _state = MutableStateFlow(InviteState())
    val state: StateFlow<InviteState> = _state.asStateFlow()

    fun edit(email: String = _state.value.email, phone: String = _state.value.phone) {
        _state.value = _state.value.copy(email = email, phone = phone, error = null)
    }

    suspend fun invite(): Boolean {
        if (!_state.value.canSubmit) return false

        _state.value = _state.value.copy(busy = true, error = null)

        return try {
            val invitation = auth.invite(
                role = UserRole.PATIENT,
                email = _state.value.email.trim().ifEmpty { null },
                phone = _state.value.phone.trim().ifEmpty { null },
                patientId = patientId,
            )

            _state.value = _state.value.copy(busy = false, issued = invitation)
            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busy = false, error = messageFor(error))
            false
        }
    }

    /** Clears the issued code, once somebody says they have passed it on. */
    fun dismiss() {
        _state.value = InviteState()
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
