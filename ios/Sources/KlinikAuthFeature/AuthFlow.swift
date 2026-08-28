import Foundation
import KlinikAPI
import KlinikCore

/// Where the user is in signing in.
///
/// Modelled as one value rather than a set of booleans: `isLoading`,
/// `needsCode` and `needsSetup` as separate flags allow combinations that
/// cannot happen, and every screen then has to defend against them.
public enum AuthStep: Sendable, Equatable {
    case credentials
    /// The account already has a second factor; it just needs this login's code.
    case twoFactorCode
    /// Staff without a second factor yet. Carries what the client must show to
    /// enrol one, and the scoped token that is the only thing allowed to do it.
    case twoFactorSetup(secret: String, otpauthURI: String)
    case signedIn
}

public struct AuthState: Sendable, Equatable {
    public var step: AuthStep = .credentials
    public var isSubmitting = false
    /// Already localised; the view renders it without deciding anything.
    public var errorMessage: String?
    /// Set while the account is locked out, so the screen can say when to retry
    /// rather than repeating "wrong password".
    public var isLockedOut = false

    public init() {}
}

/// Drives sign-in and two-factor enrolment.
///
/// Holds no SwiftUI types, so the whole flow — including the branch that only
/// staff without a second factor ever reach — is testable without a view.
public actor AuthFlowModel {
    private let auth: AuthAPI
    private let session: SessionManager

    /// The scoped token returned with MFA_SETUP_REQUIRED. Never persisted: it
    /// lives five minutes and may only reach the enrolment endpoints.
    private var setupToken: String?
    /// Kept between the password step and the code step so the user does not
    /// retype them for the second factor.
    private var pendingIdentifier: String?
    private var pendingPassword: String?

    private(set) public var state = AuthState()

    public init(auth: AuthAPI, session: SessionManager) {
        self.auth = auth
        self.session = session
    }

    public func currentState() -> AuthState { state }

    /// Step one: identifier and password.
    public func submitCredentials(identifier: String, password: String, deviceName: String?) async {
        guard !state.isSubmitting else { return }

        state.isSubmitting = true
        state.errorMessage = nil
        state.isLockedOut = false

        defer { state.isSubmitting = false }

        do {
            let response = try await auth.login(
                LoginRequest(
                    identifier: identifier,
                    password: password,
                    deviceName: deviceName
                )
            )

            pendingIdentifier = identifier
            pendingPassword = password

            try await apply(response)
        } catch {
            handle(error)
        }
    }

    /// Step two, when the account already has a second factor.
    public func submitTwoFactorCode(_ code: String) async {
        guard !state.isSubmitting else { return }
        guard let identifier = pendingIdentifier, let password = pendingPassword else {
            // Reaching here without credentials means the flow was restarted;
            // sending the user back is better than a silent failure.
            reset()
            return
        }

        state.isSubmitting = true
        state.errorMessage = nil
        defer { state.isSubmitting = false }

        do {
            let response = try await auth.login(
                LoginRequest(identifier: identifier, password: password, totpCode: code)
            )
            try await apply(response)
        } catch {
            handle(error)
        }
    }

    /// Confirms enrolment, then signs in with a fresh code.
    ///
    /// Two codes are involved on purpose: the enrolment code proves the
    /// authenticator was set up correctly, and the login that follows is a
    /// normal sign-in. Reusing the first would fail — the backend refuses a
    /// TOTP code twice.
    public func confirmTwoFactorSetup(code: String) async {
        guard !state.isSubmitting else { return }
        guard let token = setupToken else {
            reset()
            return
        }

        state.isSubmitting = true
        state.errorMessage = nil
        defer { state.isSubmitting = false }

        do {
            try await auth.confirmTotpEnrolment(code: code, setupToken: token)
            setupToken = nil
            // Enrolment done; the user now needs the *next* code to sign in.
            state.step = .twoFactorCode
        } catch {
            handle(error)
        }
    }

    public func reset() {
        setupToken = nil
        pendingIdentifier = nil
        pendingPassword = nil
        state = AuthState()
    }

    private func apply(_ response: LoginResponse) async throws {
        switch response.status {
        case .ok:
            guard let tokens = response.tokens() else {
                state.errorMessage = L10n.string("error.server")
                return
            }

            try await session.signIn(with: tokens)
            pendingIdentifier = nil
            pendingPassword = nil
            state.step = .signedIn

        case .mfaRequired:
            state.step = .twoFactorCode

        case .mfaSetupRequired:
            guard let token = response.setupToken else {
                state.errorMessage = L10n.string("error.server")
                return
            }

            setupToken = token
            let setup = try await auth.beginTotpEnrolment(setupToken: token)
            state.step = .twoFactorSetup(secret: setup.secret, otpauthURI: setup.uri)
        }
    }

    private func handle(_ error: Error) {
        guard let apiError = error as? APIError else {
            state.errorMessage = L10n.string("error.server")
            return
        }

        state.errorMessage = L10n.message(for: apiError)

        if case .auth(let code, _) = apiError, code == .accountLocked {
            // A locked account is not a typo; the screen says something else.
            state.isLockedOut = true
        }
    }
}
