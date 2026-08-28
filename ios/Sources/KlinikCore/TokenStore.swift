import Foundation

public struct SessionTokens: Sendable, Equatable, Codable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresAt: Date

    public init(accessToken: String, refreshToken: String, expiresAt: Date) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
    }

    /// Treated as expired slightly early, so a token does not lapse while the
    /// request carrying it is in flight.
    public func isExpired(now: Date = Date(), leeway: TimeInterval = 30) -> Bool {
        now.addingTimeInterval(leeway) >= expiresAt
    }
}

/// Where tokens live between launches.
///
/// Abstracted so the session logic can be tested without a Keychain, and so a
/// future variant (a shared keychain group for an app extension) is a new
/// implementation rather than a rewrite.
public protocol TokenStore: Sendable {
    func load() throws -> SessionTokens?
    func save(_ tokens: SessionTokens) throws
    func clear() throws
}

/// For tests and previews. Never used in the app: tokens must not sit in
/// process memory across launches (spec section 8).
public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: SessionTokens?

    public init(initial: SessionTokens? = nil) {
        stored = initial
    }

    public func load() throws -> SessionTokens? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    public func save(_ tokens: SessionTokens) throws {
        lock.lock()
        defer { lock.unlock() }
        stored = tokens
    }

    public func clear() throws {
        lock.lock()
        defer { lock.unlock() }
        stored = nil
    }
}
