import XCTest
@testable import KlinikCore

/// Counts refreshes so the test can prove how many reached the network.
private actor CountingRefresher: TokenRefresher {
    private(set) var callCount = 0
    private let delay: Duration
    private let outcome: Result<SessionTokens, APIError>

    init(outcome: Result<SessionTokens, APIError>, delay: Duration = .milliseconds(50)) {
        self.outcome = outcome
        self.delay = delay
    }

    func refresh(using refreshToken: String) async throws -> SessionTokens {
        callCount += 1
        try? await Task.sleep(for: delay)
        return try outcome.get()
    }

    func count() -> Int { callCount }
}

final class SessionManagerTests: XCTestCase {
    private func tokens(expiresIn seconds: TimeInterval) -> SessionTokens {
        SessionTokens(
            accessToken: "access-\(seconds)",
            refreshToken: "refresh-\(seconds)",
            expiresAt: Date().addingTimeInterval(seconds)
        )
    }

    func testReturnsCurrentTokenWhileItIsStillValid() async throws {
        let refresher = CountingRefresher(outcome: .success(tokens(expiresIn: 900)))
        let session = SessionManager(store: InMemoryTokenStore(), refresher: refresher)
        let current = tokens(expiresIn: 900)
        try await session.signIn(with: current)

        let token = try await session.validAccessToken()

        XCTAssertEqual(token, current.accessToken)
        let count = await refresher.count()
        XCTAssertEqual(count, 0, "A valid token must not trigger a refresh")
    }

    /// Treated as expired slightly early so it cannot lapse mid-flight.
    func testRefreshesATokenThatIsAboutToExpire() async throws {
        let refreshed = tokens(expiresIn: 900)
        let refresher = CountingRefresher(outcome: .success(refreshed))
        let session = SessionManager(store: InMemoryTokenStore(), refresher: refresher)
        try await session.signIn(with: tokens(expiresIn: 10))

        let token = try await session.validAccessToken()

        XCTAssertEqual(token, refreshed.accessToken)
    }

    /// The property this actor exists for.
    ///
    /// The backend revokes a whole device session when a consumed refresh token
    /// is replayed, because it cannot tell replay from theft. Two parallel
    /// refreshes would therefore sign the user out — from the client's own
    /// behaviour, with nothing wrong on the server.
    func testConcurrentCallersShareOneRefresh() async throws {
        let refresher = CountingRefresher(outcome: .success(tokens(expiresIn: 900)))
        let session = SessionManager(store: InMemoryTokenStore(), refresher: refresher)
        try await session.signIn(with: tokens(expiresIn: -1))

        let results = try await withThrowingTaskGroup(of: String.self) { group in
            for _ in 0..<20 {
                group.addTask { try await session.validAccessToken() }
            }

            var tokens: [String] = []
            for try await token in group {
                tokens.append(token)
            }
            return tokens
        }

        let count = await refresher.count()
        XCTAssertEqual(count, 1, "20 concurrent callers must produce exactly one refresh")
        XCTAssertEqual(Set(results).count, 1, "Every caller must receive the same token")
    }

    /// Requests already in flight all come back 401 carrying the same stale
    /// token. Each refreshing in turn would spend a single-use token for
    /// nothing, so only the first does.
    func testConcurrentReactionsToTheSame401ProduceOneRefresh() async throws {
        let refresher = CountingRefresher(outcome: .success(tokens(expiresIn: 900)))
        let session = SessionManager(store: InMemoryTokenStore(), refresher: refresher)
        let stale = tokens(expiresIn: 900)
        try await session.signIn(with: stale)

        let results = try await withThrowingTaskGroup(of: String.self) { group in
            for _ in 0..<10 {
                group.addTask {
                    try await session.refreshAfterUnauthorized(usedAccessToken: stale.accessToken)
                }
            }

            var tokens: [String] = []
            for try await token in group {
                tokens.append(token)
            }
            return tokens
        }

        let count = await refresher.count()
        XCTAssertEqual(count, 1)
        XCTAssertEqual(Set(results).count, 1)
    }

    func testAFailedRefreshEndsTheSession() async throws {
        let refresher = CountingRefresher(
            outcome: .failure(.unauthorized(ErrorResponse(statusCode: 401, message: "reused")))
        )
        let store = InMemoryTokenStore()
        let session = SessionManager(store: store, refresher: refresher)
        try await session.signIn(with: tokens(expiresIn: -1))

        do {
            _ = try await session.validAccessToken()
            XCTFail("Expected the refresh to fail")
        } catch {
            // Holding on to a token the server has rejected only produces more
            // failures, so it is discarded.
            let state = await session.state
            XCTAssertEqual(state, .expired)
            XCTAssertNil(try store.load())
        }
    }

    func testEveryConcurrentCallerSeesTheSameFailure() async throws {
        let refresher = CountingRefresher(
            outcome: .failure(.unauthorized(ErrorResponse(statusCode: 401, message: "reused")))
        )
        let session = SessionManager(store: InMemoryTokenStore(), refresher: refresher)
        try await session.signIn(with: tokens(expiresIn: -1))

        var failures = 0
        await withTaskGroup(of: Bool.self) { group in
            for _ in 0..<10 {
                group.addTask {
                    do {
                        _ = try await session.validAccessToken()
                        return false
                    } catch {
                        return true
                    }
                }
            }

            for await failed in group where failed {
                failures += 1
            }
        }

        XCTAssertEqual(failures, 10)
        let count = await refresher.count()
        XCTAssertEqual(count, 1, "A failing refresh must not be retried per caller")
    }

    func testAllowsANewRefreshAfterAnEarlierOneFinished() async throws {
        let refresher = CountingRefresher(outcome: .success(tokens(expiresIn: -1)))
        let session = SessionManager(store: InMemoryTokenStore(), refresher: refresher)
        try await session.signIn(with: tokens(expiresIn: -1))

        _ = try await session.validAccessToken()
        _ = try await session.validAccessToken()

        let count = await refresher.count()
        XCTAssertEqual(count, 2, "A completed refresh must not block the next one")
    }

    func testSigningOutClearsPersistedTokens() async throws {
        let store = InMemoryTokenStore()
        let refresher = CountingRefresher(outcome: .success(tokens(expiresIn: 900)))
        let session = SessionManager(store: store, refresher: refresher)
        try await session.signIn(with: tokens(expiresIn: 900))

        await session.signOut()

        XCTAssertNil(try store.load())
        let state = await session.state
        XCTAssertEqual(state, .signedOut)
    }

    func testRestoresAPersistedSessionOnLaunch() async throws {
        let stored = tokens(expiresIn: 900)
        let session = SessionManager(
            store: InMemoryTokenStore(initial: stored),
            refresher: CountingRefresher(outcome: .success(stored))
        )

        await session.restore()

        let state = await session.state
        XCTAssertEqual(state, .signedIn)
        let restored = await session.currentTokens()
        XCTAssertEqual(restored?.accessToken, stored.accessToken)
    }

    func testRefusesToProduceATokenWhenSignedOut() async throws {
        let session = SessionManager(
            store: InMemoryTokenStore(),
            refresher: CountingRefresher(outcome: .success(tokens(expiresIn: 900)))
        )

        do {
            _ = try await session.validAccessToken()
            XCTFail("Expected a failure")
        } catch {
            let apiError = try XCTUnwrap(error as? APIError)
            XCTAssertTrue(apiError.requiresReauthentication)
        }
    }
}
