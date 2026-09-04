import Foundation
import KlinikAPI
import KlinikCore

public enum ConsentsPhase: Sendable, Equatable {
    case loading
    case loaded
    case notFound
    case failed(String)
}

public struct ConsentsState: Sendable, Equatable {
    public var phase: ConsentsPhase = .loading
    public var consents: [Consent] = []
    /// The type being changed, so its button can be disabled.
    public var working: ConsentType?
    public var error: String?

    /// The one in force now, if any. A withdrawn record is not one.
    public func active(_ type: ConsentType) -> Consent? {
        consents.first { $0.type == type && $0.active }
    }

    /// The most recent record of a type, in force or not — the history line.
    public func latest(_ type: ConsentType) -> Consent? {
        consents.filter { $0.type == type }.max { $0.signedAt < $1.signedAt }
    }

    public init() {}
}

/**
 * Giving and withdrawing consent (KVKK, spec §8).
 *
 * The screen this drives is shaped by the Board's principle decision 2026/347:
 * the privacy notice and the consent are separate, the notice takes only an
 * acknowledgement that it was read, and nothing is asked for where a
 * non-consent ground applies. `ConsentType.askable` is where that last rule
 * lives; this model never sends anything else, and the server refuses it too.
 *
 * Withdrawal is as easy as giving, and on the same screen. A consent that can
 * only be taken back by e-mailing the clinic is one the clinic has made harder
 * to withdraw than to give.
 */
public actor ConsentsModel {
    private let api: ConsentsAPI

    /**
     * Which wording is being agreed to.
     *
     * Sent with every consent because "they agreed" names nothing without it —
     * and because a text that changes later must not silently inherit an
     * agreement to the old one.
     */
    private let version: Int

    private(set) public var state = ConsentsState()

    public init(api: ConsentsAPI, version: Int = 1) {
        self.api = api
        self.version = version
    }

    public func currentState() -> ConsentsState { state }

    public func load() async {
        state.phase = .loading
        state.error = nil

        do {
            state.consents = try await api.mine()
            state.phase = .loaded
        } catch let error as APIError {
            if case .notFound = error {
                // No patient file linked yet. Nothing to fetch until the clinic
                // links one, so not a failure to retry.
                state.phase = .notFound
            } else {
                state.phase = .failed(L10n.message(for: error))
            }
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    @discardableResult
    public func give(_ type: ConsentType) async -> Bool {
        guard ConsentType.askable.contains(type) else { return false }

        return await change(type) { [version] in
            _ = try await self.api.give(type: type, version: version)
        }
    }

    @discardableResult
    public func withdraw(_ type: ConsentType) async -> Bool {
        guard let consent = state.active(type) else { return false }

        return await change(type) {
            _ = try await self.api.withdraw(consent.id)
        }
    }

    private func change(_ type: ConsentType, _ work: () async throws -> Void) async -> Bool {
        guard state.working == nil else { return false }

        state.working = type
        state.error = nil
        defer { state.working = nil }

        do {
            try await work()
        } catch let error as APIError {
            state.error = L10n.message(for: error)
            return false
        } catch {
            state.error = L10n.string("error.server")
            return false
        }

        // Reloaded rather than patched locally: giving a consent supersedes the
        // previous one server-side, and a local edit would leave the screen
        // showing two.
        await load()

        return true
    }
}
