package xyz.klinik.shell

import xyz.klinik.network.Identity
import xyz.klinik.network.SessionState
import xyz.klinik.network.UserRole

/**
 * What the app shows, and why (T2.3–T2.5).
 *
 * The whole of the shell's decision-making, as a pure function of the two
 * things it depends on — is there a session, and whose is it — so it can be
 * tested without an emulator. Everything in the app module is wiring around
 * this.
 *
 * The reason it is worth isolating: getting it wrong shows the wrong person the
 * wrong thing. A patient must never land on the staff patient list, and a
 * signed-out user must never land anywhere but sign-in — and both are one `if`
 * away from being true by accident.
 *
 * Kept in a plain JVM module deliberately, so these tests run on a laptop and
 * in CI rather than needing a device.
 */
sealed interface RootRoute {
    /** No usable session. The only screen that does not need one. */
    data object SignIn : RootRoute

    /**
     * The session lapsed while the app was closed. A different screen from a
     * cold sign-in: the user did nothing wrong and should not be left
     * wondering whether their account is gone.
     */
    data object SignInAgain : RootRoute

    /** A patient, looking at their own file. */
    data class PatientHome(val patientId: String?) : RootRoute

    /** Clinic staff, looking at the patient list. */
    data class StaffHome(val role: UserRole) : RootRoute

    /** Signed in, and the account is not one this app has a home for. */
    data class Unsupported(val role: UserRole) : RootRoute
}

data class RootInput(
    val session: SessionState,
    /** Absent until `/me/identity` answers, which is a moment after launch. */
    val identity: Identity? = null,
)

object Root {
    /**
     * The route for a given state.
     *
     * `null` means "not decided yet" and the caller shows the launch screen. It
     * is a distinct answer from [RootRoute.SignIn]: guessing sign-in while the
     * identity call is in flight would flash the login screen at somebody who
     * is already signed in, on every single launch.
     */
    fun route(input: RootInput): RootRoute? = when (input.session) {
        SessionState.SIGNED_OUT -> RootRoute.SignIn
        SessionState.EXPIRED -> RootRoute.SignInAgain
        SessionState.SIGNED_IN -> {
            val identity = input.identity

            when {
                identity == null -> null
                identity.isStaff -> RootRoute.StaffHome(identity.role)
                // The file id may still be null: an account activated from an
                // invitation exists before it is linked. The home screen
                // handles that; the router does not pretend it is staff.
                identity.role == UserRole.PATIENT -> RootRoute.PatientHome(identity.patientId)
                // Section 2 gives a caregiver limited access to somebody else's
                // file and this app has no screen for that yet. Saying so is
                // honest; routing them to a patient home that is not theirs
                // would not be.
                else -> RootRoute.Unsupported(identity.role)
            }
        }
    }
}
