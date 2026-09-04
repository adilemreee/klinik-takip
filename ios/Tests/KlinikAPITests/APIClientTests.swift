import XCTest
import KlinikCore
@testable import KlinikAPI

/// Records what the client sent and replays scripted responses.
private actor RecordingTransport: HTTPTransport {
    private var responses: [HTTPResponse]
    private(set) var requests: [URLRequest] = []

    init(responses: [HTTPResponse]) {
        self.responses = responses
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        requests.append(request)

        guard !responses.isEmpty else {
            return HTTPResponse(status: 500, body: Data())
        }

        return responses.removeFirst()
    }

    func sent() -> [URLRequest] { requests }
}

private actor StubRefresher: TokenRefresher {
    private(set) var callCount = 0

    func refresh(using refreshToken: String) async throws -> SessionTokens {
        callCount += 1
        return SessionTokens(
            accessToken: "refreshed-access",
            refreshToken: "refreshed-refresh",
            expiresAt: Date().addingTimeInterval(900)
        )
    }

    func count() -> Int { callCount }
}

private struct Payload: Decodable, Equatable {
    let value: String
}

final class APIClientTests: XCTestCase {
    private let baseURL = URL(string: "https://api.example.test")!

    private func makeClient(
        responses: [HTTPResponse],
        tokens: SessionTokens? = SessionTokens(
            accessToken: "current-access",
            refreshToken: "current-refresh",
            expiresAt: Date().addingTimeInterval(900)
        )
    ) async throws -> (APIClient, RecordingTransport, StubRefresher) {
        let transport = RecordingTransport(responses: responses)
        let refresher = StubRefresher()
        let session = SessionManager(store: InMemoryTokenStore(), refresher: refresher)

        if let tokens {
            try await session.signIn(with: tokens)
        }

        let client = APIClient(
            configuration: APIConfiguration(baseURL: baseURL),
            transport: transport,
            session: session
        )

        return (client, transport, refresher)
    }

    private func json(_ text: String, status: Int = 200) -> HTTPResponse {
        HTTPResponse(status: status, body: Data(text.utf8))
    }

    func testAttachesTheBearerTokenAndDecodesTheBody() async throws {
        let (client, transport, _) = try await makeClient(responses: [json(#"{"value":"ok"}"#)])

        let result = try await client.send(Endpoint(method: .get, path: "patients"), as: Payload.self)

        XCTAssertEqual(result, Payload(value: "ok"))
        let sent = await transport.sent()
        XCTAssertEqual(sent.first?.value(forHTTPHeaderField: "Authorization"), "Bearer current-access")
    }

    /// Sign-in and refresh must not carry a token: attaching an expired one
    /// would trigger a refresh in order to call refresh.
    func testSendsNoTokenOnUnauthenticatedEndpoints() async throws {
        let (client, transport, _) = try await makeClient(
            responses: [json(#"{"value":"ok"}"#)],
            tokens: nil
        )

        _ = try await client.send(
            Endpoint(method: .post, path: "auth/login", requiresAuthentication: false),
            as: Payload.self
        )

        let sent = await transport.sent()
        XCTAssertNil(sent.first?.value(forHTTPHeaderField: "Authorization"))
    }

    func testRefreshesOnceAndRetriesAfterA401() async throws {
        let (client, transport, refresher) = try await makeClient(
            responses: [json("{}", status: 401), json(#"{"value":"after-refresh"}"#)]
        )

        let result = try await client.send(Endpoint(method: .get, path: "patients"), as: Payload.self)

        XCTAssertEqual(result, Payload(value: "after-refresh"))
        let refreshCount = await refresher.count()
        XCTAssertEqual(refreshCount, 1)

        let sent = await transport.sent()
        XCTAssertEqual(sent.count, 2)
        XCTAssertEqual(sent.last?.value(forHTTPHeaderField: "Authorization"), "Bearer refreshed-access")
    }

    /// One retry, no more. Each refresh spends a single-use token, so looping
    /// would burn the chain and get the whole device session revoked.
    func testGivesUpAfterASecond401RatherThanLooping() async throws {
        let (client, transport, refresher) = try await makeClient(
            responses: [json("{}", status: 401), json("{}", status: 401), json("{}", status: 401)]
        )

        do {
            _ = try await client.send(Endpoint(method: .get, path: "patients"), as: Payload.self)
            XCTFail("Expected the second 401 to surface")
        } catch {
            let apiError = try XCTUnwrap(error as? APIError)
            XCTAssertTrue(apiError.requiresReauthentication)
        }

        let refreshCount = await refresher.count()
        XCTAssertEqual(refreshCount, 1, "Exactly one refresh attempt")
        let sent = await transport.sent()
        XCTAssertEqual(sent.count, 2, "Original request plus exactly one retry")
    }

    func testDoesNotRefreshOnAnUnauthenticatedEndpoint() async throws {
        let (client, _, refresher) = try await makeClient(
            responses: [json("{}", status: 401)],
            tokens: nil
        )

        do {
            _ = try await client.send(
                Endpoint(method: .post, path: "auth/login", requiresAuthentication: false),
                as: Payload.self
            )
            XCTFail("Expected a failure")
        } catch {
            let refreshCount = await refresher.count()
            XCTAssertEqual(refreshCount, 0, "A failed sign-in must not attempt a refresh")
        }
    }

    func testMapsTheAuthenticationCodeTheBackendReturns() async throws {
        let (client, _, _) = try await makeClient(
            responses: [json(#"{"statusCode":401,"message":"MFA_REQUIRED"}"#, status: 401)],
            tokens: nil
        )

        do {
            _ = try await client.send(
                Endpoint(method: .post, path: "auth/login", requiresAuthentication: false),
                as: Payload.self
            )
            XCTFail("Expected a failure")
        } catch {
            guard case .auth(let code, _) = try XCTUnwrap(error as? APIError) else {
                return XCTFail("Expected an auth error")
            }
            XCTAssertEqual(code, .mfaRequired)
        }
    }

    func testMapsStatusCodesToTheCasesTheUIBranchesOn() async throws {
        let cases: [(Int, String)] = [
            (400, "validation"),
            (403, "forbidden"),
            (404, "notFound"),
            (409, "conflict"),
            (503, "server"),
        ]

        for (status, expected) in cases {
            let (client, _, _) = try await makeClient(responses: [json("{}", status: status)])

            do {
                _ = try await client.send(Endpoint(method: .get, path: "x"), as: Payload.self)
                XCTFail("Expected \(status) to fail")
            } catch {
                let apiError = try XCTUnwrap(error as? APIError)
                XCTAssertTrue(
                    String(describing: apiError).contains(expected),
                    "\(status) should map to \(expected), got \(apiError)"
                )
            }
        }
    }

    /// The backend answers 404 for a record outside the caller's scope, so the
    /// client must not tell the user the record exists.
    func testTreatsOutOfScopeAsNotFound() async throws {
        let (client, _, _) = try await makeClient(responses: [json("{}", status: 404)])

        do {
            _ = try await client.send(Endpoint(method: .get, path: "patients/x"), as: Payload.self)
            XCTFail("Expected a failure")
        } catch {
            guard case .notFound = try XCTUnwrap(error as? APIError) else {
                return XCTFail("Expected notFound")
            }
        }
    }

    func testReadsRetryAfterOnRateLimiting() async throws {
        let transport = RecordingTransport(responses: [
            HTTPResponse(status: 429, body: Data("{}".utf8), headers: ["retry-after": "30"])
        ])
        let session = SessionManager(store: InMemoryTokenStore(), refresher: StubRefresher())
        try await session.signIn(
            with: SessionTokens(accessToken: "a", refreshToken: "r", expiresAt: Date().addingTimeInterval(900))
        )
        let client = APIClient(
            configuration: APIConfiguration(baseURL: baseURL),
            transport: transport,
            session: session
        )

        do {
            _ = try await client.send(Endpoint(method: .get, path: "x"), as: Payload.self)
            XCTFail("Expected a failure")
        } catch {
            guard case .rateLimited(let retryAfter) = try XCTUnwrap(error as? APIError) else {
                return XCTFail("Expected rateLimited")
            }
            XCTAssertEqual(retryAfter, 30)
        }
    }

    func testOrdersQueryParametersSoRequestsAreReproducible() async throws {
        let (client, transport, _) = try await makeClient(responses: [json(#"{"value":"ok"}"#)])

        _ = try await client.send(
            Endpoint(method: .get, path: "patients", query: ["limit": "25", "country": "DE", "q": "a"]),
            as: Payload.self
        )

        let sent = await transport.sent()
        XCTAssertEqual(sent.first?.url?.query, "country=DE&limit=25&q=a")
    }

    func testSendsAcceptLanguageSoTheBackendCanLocalise() async throws {
        let transport = RecordingTransport(responses: [json(#"{"value":"ok"}"#)])
        let session = SessionManager(store: InMemoryTokenStore(), refresher: StubRefresher())
        let client = APIClient(
            configuration: APIConfiguration(baseURL: baseURL, preferredLanguage: "de"),
            transport: transport,
            session: session
        )

        _ = try await client.send(
            Endpoint(method: .get, path: "x", requiresAuthentication: false),
            as: Payload.self
        )

        let sent = await transport.sent()
        XCTAssertEqual(sent.first?.value(forHTTPHeaderField: "Accept-Language"), "de")
    }

    func testReportsADecodingFailureRatherThanCrashing() async throws {
        let (client, _, _) = try await makeClient(responses: [json(#"{"unexpected":true}"#)])

        do {
            _ = try await client.send(Endpoint(method: .get, path: "x"), as: Payload.self)
            XCTFail("Expected a failure")
        } catch {
            guard case .decoding = try XCTUnwrap(error as? APIError) else {
                return XCTFail("Expected a decoding error")
            }
        }
    }
}

/**
 * Endpoints that answer 200 with an empty body to mean "there is none".
 *
 * Found by running the client against the real server: a patient with no
 * check-up schedule got "something went wrong", because empty data is not
 * valid JSON and the decode threw.
 */
final class EmptyBodyDecodingTests: XCTestCase {
    private struct Schedule: Decodable, Sendable, Equatable {
        let id: String
    }

    private func client(returning body: String) async throws -> APIClient {
        let transport = RecordingTransport(responses: [
            HTTPResponse(status: 200, body: Data(body.utf8)),
        ])
        let session = SessionManager(store: InMemoryTokenStore(), refresher: StubRefresher())

        try await session.signIn(
            with: SessionTokens(
                accessToken: "a",
                refreshToken: "r",
                expiresAt: Date().addingTimeInterval(900)
            )
        )

        return APIClient(
            configuration: APIConfiguration(baseURL: URL(string: "https://api.test")!),
            transport: transport,
            session: session
        )
    }

    func testAnEmptyBodyDecodesAsNothing() async throws {
        let result = try await (client(returning: "")).send(
            Endpoint(method: .get, path: "me/follow-up"),
            as: Schedule?.self
        )

        XCTAssertNil(result, "an empty body means there is none, not a failure")
    }

    func testALiteralNullAlsoDecodesAsNothing() async throws {
        let result = try await (client(returning: "null")).send(
            Endpoint(method: .get, path: "me/follow-up"),
            as: Schedule?.self
        )

        XCTAssertNil(result)
    }

    func testAnEmptyBodyWhereAValueIsRequiredIsStillAnError() async throws {
        // The substitution must not paper over a genuinely missing payload:
        // a screen that needs a value and silently gets none is worse than one
        // that says the request failed.
        do {
            _ = try await (client(returning: "")).send(
                Endpoint(method: .get, path: "patients/1"),
                as: Schedule.self
            )
            XCTFail("an empty body should not satisfy a non-optional response")
        } catch let error as APIError {
            guard case .decoding = error else {
                return XCTFail("expected a decoding error, got \(error)")
            }
        }
    }

    func testABodyIsStillDecodedNormally() async throws {
        let result = try await (client(returning: #"{"id":"s1"}"#)).send(
            Endpoint(method: .get, path: "me/follow-up"),
            as: Schedule?.self
        )

        XCTAssertEqual(result, Schedule(id: "s1"))
    }
}
