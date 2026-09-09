import XCTest
import KlinikCore
@testable import KlinikAPI

private struct FailingTransport: HTTPTransport {
    let error: APIError

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        throw error
    }
}

private actor CountingTransport: HTTPTransport {
    private let body: String
    private(set) var calls = 0

    init(body: String) {
        self.body = body
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        calls += 1

        return HTTPResponse(status: 200, body: Data(body.utf8))
    }

    func made() -> Int { calls }
}

private struct StatusTransport: HTTPTransport {
    let status: Int

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        HTTPResponse(status: status, body: Data(#"{"statusCode":404,"message":"gone"}"#.utf8))
    }
}

private struct NoRefresh: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

private actor Recorder: ConnectionObserver {
    private(set) var events: [String] = []

    func reachedServer() async { events.append("live") }
    func servedFromCache(storedAt: Date) async { events.append("cached") }
    func couldNotReachServer() async { events.append("unreachable") }

    func seen() -> [String] { events }
}

private struct Payload: Decodable, Sendable, Equatable {
    let value: String
}

private func client(
    _ transport: HTTPTransport,
    cache: ResponseCache?,
    observer: ConnectionObserver? = nil
) async -> APIClient {
    let session = SessionManager(store: InMemoryTokenStore(), refresher: NoRefresh())
    try? await session.signIn(
        with: SessionTokens(
            accessToken: "access",
            refreshToken: "refresh",
            expiresAt: Date().addingTimeInterval(900)
        )
    )

    return APIClient(
        configuration: APIConfiguration(baseURL: URL(string: "https://api.test")!),
        transport: transport,
        session: session,
        cache: cache,
        connection: observer
    )
}

/**
 * The offline fallback (spec M15).
 *
 * The rule being protected is narrow and matters: a stale copy is shown only
 * when the clinic could not be reached, never when it answered.
 */
final class ResponseCacheTests: XCTestCase {
    private let get = Endpoint(method: .get, path: "me/summary")

    func testASuccessfulReadIsRemembered() async throws {
        let cache = InMemoryResponseCache()
        let live = await client(CountingTransport(body: #"{"value":"taze"}"#), cache: cache)

        _ = try await live.send(get, as: Payload.self)

        let stored = await cache.load(for: cacheKey(method: .get, path: "me/summary", query: [:]))
        XCTAssertNotNil(stored)
    }

    func testAnOfflineReadFallsBackToWhatWasLastSeen() async throws {
        let cache = InMemoryResponseCache()
        let observer = Recorder()

        let live = await client(
            CountingTransport(body: #"{"value":"taze"}"#),
            cache: cache,
            observer: observer
        )
        _ = try await live.send(get, as: Payload.self)

        let offline = await client(
            FailingTransport(error: .offline),
            cache: cache,
            observer: observer
        )
        let served = try await offline.send(get, as: Payload.self)

        let events = await observer.seen()

        XCTAssertEqual(served, Payload(value: "taze"))
        XCTAssertEqual(events, ["live", "cached"])
    }

    /**
     * A server that answered is not overruled.
     *
     * A 404 means the record is gone — deleted, or moved out of this user's
     * scope. Serving yesterday's copy of it would be the client deciding it
     * knows better than the clinic, and in the scope case it would show
     * somebody a file they may no longer see.
     */
    func testAFourOhFourIsNotAnsweredFromTheCache() async throws {
        let cache = InMemoryResponseCache()

        let live = await client(CountingTransport(body: #"{"value":"taze"}"#), cache: cache)
        _ = try await live.send(get, as: Payload.self)

        let gone = await client(StatusTransport(status: 404), cache: cache)

        do {
            _ = try await gone.send(get, as: Payload.self)
            XCTFail("a 404 must not be served from the cache")
        } catch let error as APIError {
            guard case .notFound = error else {
                return XCTFail("expected notFound, got \(error)")
            }
        }
    }

    /// With nothing stored, an offline read is still an offline read.
    func testAnEmptyCacheDoesNotHideTheFailure() async {
        let observer = Recorder()
        let offline = await client(
            FailingTransport(error: .offline),
            cache: InMemoryResponseCache(),
            observer: observer
        )

        do {
            _ = try await offline.send(get, as: Payload.self)
            XCTFail("expected the offline error to surface")
        } catch let error as APIError {
            XCTAssertEqual(error, .offline)
        } catch {
            XCTFail("expected an APIError")
        }

        let events = await observer.seen()
        XCTAssertEqual(events, ["unreachable"])
    }

    /**
     * Writes are never served from the cache.
     *
     * Replaying a stored answer to a `POST` would tell somebody their message
     * was sent when nothing left the device.
     */
    func testAWriteIsNotCachedAndNeverFallsBack() async {
        let cache = InMemoryResponseCache()
        let post = Endpoint(method: .post, path: "conversations/c1/messages")

        let offline = await client(FailingTransport(error: .offline), cache: cache)

        do {
            _ = try await offline.send(post, as: Payload.self)
            XCTFail("expected the write to fail")
        } catch let error as APIError {
            XCTAssertEqual(error, .offline)
        } catch {
            XCTFail("expected an APIError")
        }

        let stored = await cache.load(
            for: cacheKey(method: .post, path: "conversations/c1/messages", query: [:])
        )
        XCTAssertNil(stored)
    }

    /// Two requests differing only in parameter order share one entry.
    func testTheKeyIsIndependentOfQueryOrder() {
        XCTAssertEqual(
            cacheKey(method: .get, path: "patients", query: ["q": "ayse", "country": "TR"]),
            cacheKey(method: .get, path: "patients", query: ["country": "TR", "q": "ayse"])
        )
    }
}
