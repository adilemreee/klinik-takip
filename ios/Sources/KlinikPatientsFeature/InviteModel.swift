import Foundation
import KlinikAPI
import KlinikCore

public enum InvitePhase: Sendable, Equatable {
    case editing
    case sending
    /// The code, which the server will never show again.
    case issued(Invitation)
    case failed(String)
}

public struct InviteState: Sendable, Equatable {
    public var phase: InvitePhase = .editing

    public init() {}
}

/**
 * Inviting a patient to open an account (spec M1).
 *
 * The file exists first and the login comes later — the clinic opens the file
 * when somebody books, and the account when they are ready to use the app. The
 * endpoint has been there since the first phase and nothing could call it, so a
 * patient the clinic had a file for could not be given a way in.
 *
 * The code comes back exactly once. Only its hash is stored, so a screen that
 * loses it has lost it: this model keeps it in the state until the clinician
 * leaves, and the screen makes copying it the obvious next action.
 */
@MainActor
public final class InviteModel {
    private let api: AuthAPI
    private let patientId: String

    private var state = InviteState()

    public init(api: AuthAPI, patientId: String) {
        self.api = api
        self.patientId = patientId
    }

    public func currentState() -> InviteState { state }

    public func invite(email: String, phone: String) async {
        guard let problem = InviteModel.problem(email: email, phone: phone) else {
            state.phase = .sending

            do {
                let invitation = try await api.invite(
                    email: email.trimmed.isEmpty ? nil : email.trimmed,
                    phone: phone.trimmed.isEmpty ? nil : phone.trimmed,
                    role: "PATIENT",
                    patientId: patientId
                )

                state.phase = .issued(invitation)
            } catch let error as APIError {
                state.phase = .failed(L10n.message(for: error))
            } catch {
                state.phase = .failed(L10n.string("error.server"))
            }

            return
        }

        state.phase = .failed(problem)
    }

    /// Nil when the form is good. Checked here rather than left to the server so
    /// a clinician is not told "400" for an empty box.
    ///
    /// Nonisolated: it reads nothing but its arguments, and making the view ask
    /// the main actor whether a field is empty would be a hop for nothing.
    public nonisolated static func problem(email: String, phone: String) -> String? {
        if email.trimmed.isEmpty && phone.trimmed.isEmpty {
            return L10n.string("invite.needContact")
        }

        // Not a full address grammar — the server owns that. Just enough to
        // catch the phone number typed into the e-mail box.
        if !email.trimmed.isEmpty, !email.contains("@") {
            return L10n.string("invite.badEmail")
        }

        return nil
    }
}