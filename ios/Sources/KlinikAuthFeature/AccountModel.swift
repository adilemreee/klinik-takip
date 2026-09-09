import Foundation
import KlinikAPI
import KlinikCore

public enum AccountPhase: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

public struct AccountState: Sendable, Equatable {
    public var phase: AccountPhase = .loading
    /// Newest first, with the device in hand marked.
    public var sessions: [DeviceSession] = []
    public var busyId: String?
    public var error: String?

    public init() {}

    public var others: [DeviceSession] { sessions.filter { !$0.current } }
    public var current: DeviceSession? { sessions.first(\.current) }
}

/**
 * The devices signed in to this account (spec M1).
 *
 * Somebody who has lost a phone needs to end its session, and until this screen
 * existed the only way was to change the password and hope. The current device
 * is shown but cannot be revoked from here: signing yourself out is what the
 * sign-out button is for, and offering it twice — once labelled "revoke" — is
 * how a person ends the wrong session.
 */
@MainActor
public final class AccountModel {
    private let api: AuthAPI
    private var state = AccountState()

    public init(api: AuthAPI) {
        self.api = api
    }

    public func currentState() -> AccountState { state }

    public func load() async {
        do {
            state.sessions = try await api.sessions()
                .sorted { $0.lastSeenAt > $1.lastSeenAt }
            state.phase = .loaded
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    public func revoke(_ familyId: String) async {
        state.busyId = familyId
        state.error = nil

        defer { state.busyId = nil }

        do {
            try await api.revokeSession(familyId: familyId)
            state.sessions.removeAll { $0.familyId == familyId }
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }
    }

    /// Ends every session including this one. The caller signs out afterwards;
    /// the tokens in the keychain are already dead by then.
    public func signOutEverywhere() async -> Bool {
        state.error = nil

        do {
            try await api.signOutEverywhere()
            return true
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }

        return false
    }
}

private extension Array where Element == DeviceSession {
    func first(_ keyPath: KeyPath<DeviceSession, Bool>) -> DeviceSession? {
        first { $0[keyPath: keyPath] }
    }
}
