import Foundation
import KlinikAPI
import KlinikCore

/**
 * What the app shows, and why (T2.3–T2.5).
 *
 * The whole of the shell's decision-making, kept as a pure function of the two
 * things it depends on — is there a session, and whose is it — so it can be
 * tested without a screen, a network or a simulator. Everything else in the app
 * target is wiring.
 *
 * The reason this is worth isolating: getting it wrong shows the wrong person
 * the wrong thing. A patient must never land on the staff patient list, and a
 * signed-out user must never land anywhere but sign-in — and both of those are
 * one `if` away from being true by accident.
 */

public enum RootRoute: Sendable, Equatable {
    /// No usable session. The only screen that does not need one.
    case signIn
    /// The session lapsed while the app was closed; say so rather than
    /// pretending the user never signed in.
    case signInAgain
    /// A patient, looking at their own file.
    case patientHome(patientId: String?)
    /// Clinic staff, looking at the patient list.
    case staffHome(role: UserRole)
    /// Signed in, and the account is not one this app has a home for.
    case unsupported(role: UserRole)
}

/// What the shell knows when it decides.
public struct RootInput: Sendable, Equatable {
    public let session: SessionState
    /// Absent until `/me/identity` answers, which is a moment after launch.
    public let identity: Identity?

    public init(session: SessionState, identity: Identity?) {
        self.session = session
        self.identity = identity
    }
}

public enum Root {
    /**
     * The route for a given state.
     *
     * `nil` means "not yet decided" and the caller shows the launch screen. It
     * is a distinct answer from `signIn`: guessing sign-in while the identity
     * call is still in flight would flash the login screen at somebody who is
     * already signed in, every single launch.
     */
    public static func route(for input: RootInput) -> RootRoute? {
        switch input.session {
        case .signedOut:
            return .signIn

        case .expired:
            // A different screen from a cold sign-in: the user did nothing
            // wrong and should not be left wondering whether their account is
            // gone.
            return .signInAgain

        case .signedIn:
            guard let identity = input.identity else { return nil }

            if identity.isStaff {
                return .staffHome(role: identity.role)
            }

            switch identity.role {
            case .patient:
                // The file id may still be null: an account activated from an
                // invitation exists before it is linked. The home screen
                // handles that; the router does not pretend it is staff.
                return .patientHome(patientId: identity.patientId)

            case .caregiver:
                // Spec section 2 gives a caregiver limited access to somebody
                // else's file, and this app has no screen for that yet.
                // Refusing to route is honest; routing them to a patient home
                // that is not theirs would not be.
                return .unsupported(role: .caregiver)

            default:
                return .unsupported(role: identity.role)
            }
        }
    }
}
