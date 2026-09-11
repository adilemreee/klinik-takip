import Foundation

/// Performs the token refresh call. Injected so the session logic is testable
/// without a network.
public protocol TokenRefresher: Sendable {
    func refresh(using refreshToken: String) async throws -> SessionTokens
}

public enum SessionState: Sendable, Equatable {
    case signedOut
    case signedIn
    /// The refresh chain is broken; the user has to sign in again.
    case expired
}

/// Owns the tokens and, crucially, serialises refreshing them.
///
/// The backend issues single-use refresh tokens and revokes the entire device
/// session when a consumed one is replayed — that is its defence against a
/// stolen token. It also means a client that refreshes twice in parallel signs
/// its own user out: the second call replays a token the first has already
/// spent, and the server cannot tell that from theft.
///
/// So concurrent callers that find an expired token must not each start a
/// refresh. They join the one already running.
public actor SessionManager {
    private let store: TokenStore
    private let refresher: TokenRefresher

    private var tokens: SessionTokens?
    private var refreshTask: Task<SessionTokens, Error>?
    private var listeners: [UUID: AsyncStream<SessionState>.Continuation] = [:]

    private(set) public var state: SessionState = .signedOut {
        didSet {
            guard state != oldValue else { return }

            for continuation in listeners.values {
                continuation.yield(state)
            }
        }
    }

    public init(store: TokenStore, refresher: TokenRefresher) {
        self.store = store
        self.refresher = refresher
    }

    /**
     * Every change to the session, starting with the one in force now.
     *
     * Without this the shell reads the state at launch and never again — so a
     * session that lapses mid-use leaves the app on whatever screen it was on,
     * failing every request, with no way to sign in again short of deleting it.
     * The first value is sent immediately so a listener starts from the truth.
     */
    public func updates() -> AsyncStream<SessionState> {
        let (stream, continuation) = AsyncStream<SessionState>.makeStream()
        let id = UUID()

        listeners[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.stopListening(id) }
        }
        continuation.yield(state)

        return stream
    }

    private func stopListening(_ id: UUID) {
        listeners[id] = nil
    }

    /// Reads whatever was persisted, so a relaunch does not force a sign-in.
    public func restore() async {
        tokens = try? store.load()
        state = tokens == nil ? .signedOut : .signedIn
    }

    public func signIn(with tokens: SessionTokens) throws {
        self.tokens = tokens
        try store.save(tokens)
        state = .signedIn
    }

    public func signOut() {
        tokens = nil
        refreshTask?.cancel()
        refreshTask = nil
        try? store.clear()
        state = .signedOut
    }

    public func currentTokens() -> SessionTokens? {
        tokens
    }

    /// An access token that is valid now, refreshing first if necessary.
    public func validAccessToken() async throws -> String {
        guard let current = tokens else {
            throw APIError.unauthorized(ErrorResponse(statusCode: 401, message: "Not signed in"))
        }

        if !current.isExpired() {
            return current.accessToken
        }

        return try await performRefresh(from: current).accessToken
    }

    /// Called after a 401 on a request that carried a token we believed valid —
    /// the server may have revoked the session, or the clock may have drifted.
    ///
    /// Takes the token the failed request actually used. Several requests in
    /// flight all receive 401 carrying the same stale token, and each
    /// refreshing in turn would spend a single-use token for nothing. Comparing
    /// against what is held tells a caller whether someone has already fixed
    /// the problem it is reacting to.
    public func refreshAfterUnauthorized(usedAccessToken: String) async throws -> String {
        guard let current = tokens else {
            throw APIError.unauthorized(ErrorResponse(statusCode: 401, message: "Not signed in"))
        }

        if current.accessToken != usedAccessToken {
            return current.accessToken
        }

        return try await performRefresh(from: current).accessToken
    }

    private func performRefresh(from current: SessionTokens) async throws -> SessionTokens {
        // Join a refresh already in flight rather than starting a second one.
        if let existing = refreshTask {
            return try await existing.value
        }

        let task = Task<SessionTokens, Error> { [refresher, store] in
            let refreshed = try await refresher.refresh(using: current.refreshToken)
            try store.save(refreshed)
            return refreshed
        }

        refreshTask = task

        do {
            let refreshed = try await task.value
            tokens = refreshed
            state = .signedIn
            refreshTask = nil
            return refreshed
        } catch {
            refreshTask = nil

            /*
             * A refresh that never reached the server says nothing about the
             * session.
             *
             * Ending it here would sign somebody out for being on an aeroplane
             * — and take their queued writes with them, which is the one thing
             * the queue exists to prevent. The tokens are kept, the caller sees
             * the connection error, and the next attempt with signal decides.
             */
            if SessionManager.wasUnreachable(error) {
                throw error
            }

            // A *rejected* refresh means the chain is over: either the token
            // was already spent, or the server revoked the family. Holding on
            // to it would only produce more failures.
            tokens = nil
            try? store.clear()
            state = .expired
            throw error
        }
    }

    /// Whether the refresh failed to reach a server at all, as opposed to
    /// being turned down by one.
    static func wasUnreachable(_ error: Error) -> Bool {
        switch error {
        case let api as APIError:
            // A 5xx is the server struggling, not the session ending: a gateway
            // that answers 502 has not judged the refresh token.
            if case .server = api { return true }
            if case .rateLimited = api { return true }

            return api.isConnectivity

        case is CancellationError:
            return true

        default:
            // Anything this layer does not recognise — a transport that throws
            // its own type, a decoding failure on a truncated body — is far
            // more likely to be a bad connection than a revoked session, and
            // the cost of guessing wrong in that direction is one extra 401.
            return true
        }
    }
}
