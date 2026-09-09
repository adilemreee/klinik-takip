import XCTest
import KlinikCore
@testable import KlinikAPI

/// Records what it was asked to send, and answers however the test says.
private actor ScriptedTransport: HTTPTransport {
    private var answers: [HTTPResponse]
    private let failure: APIError?
    private(set) var requests: [URLRequest] = []

    init(answers: [HTTPResponse] = [], failure: APIError? = nil) {
        self.answers = answers
        self.failure = failure
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        requests.append(request)

        if let failure { throw failure }

        return answers.isEmpty ? HTTPResponse(status: 200, body: Data()) : answers.removeFirst()
    }

    func sent() -> [URLRequest] { requests }
}

private actor SpyQueue: PendingWriteQueue {
    private(set) var kept: [PendingWrite] = []
    private let refuses: Bool

    init(refuses: Bool = false) {
        self.refuses = refuses
    }

    func enqueue(_ write: PendingWrite) async throws {
        if refuses { throw APIError.unknown(status: 0) }

        kept.append(write)
    }

    func written() -> [PendingWrite] { kept }
}

private struct NoRefresh: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

private func client(_ transport: HTTPTransport, queue: PendingWriteQueue? = nil) async -> APIClient {
    let session = SessionManager(store: InMemoryTokenStore(), refresher: NoRefresh())
    try? await session.signIn(
        with: SessionTokens(
            accessToken: "access",
            refreshToken: "refresh",
            expiresAt: Date().addingTimeInterval(900)
        )
    )

    let client = APIClient(
        configuration: APIConfiguration(baseURL: URL(string: "https://api.test")!),
        transport: transport,
        session: session
    )

    if let queue { await client.useQueue(queue) }

    return client
}

/**
 * Writes that survive a dead connection (spec M15).
 *
 * The rule this file protects: a write is kept only when the clinic could not
 * be reached, and only when the endpoint said it may be. Everything else fails
 * exactly as it did before — a server that answered "no" has answered, and
 * queueing its refusal would tell somebody their work is on its way to a
 * clinic that has already refused it.
 */
final class WriteQueueTests: XCTestCase {
    private let queueable = Endpoint(
        method: .post,
        path: "me/measurements",
        body: Data(#"{"value":78.4}"#.utf8),
        offline: .queue(.standalone(entityType: "measurement", summary: "Ölçüm: Kilo"))
    )

    // MARK: - What is kept

    func testAWriteThatCouldNotBeDeliveredIsKept() async throws {
        let queue = SpyQueue()
        let offline = await client(ScriptedTransport(failure: .offline), queue: queue)

        do {
            try await offline.send(queueable)
            XCTFail("A queued write has no answer to return")
        } catch let error as APIError {
            // Not a failure the screen apologises for: the work is on the phone.
            XCTAssertEqual(error, .queuedForLater)
        }

        let kept = await queue.written()
        XCTAssertEqual(kept.count, 1)
        XCTAssertEqual(kept.first?.path, "me/measurements")
        XCTAssertEqual(kept.first?.method, .post)
        XCTAssertEqual(kept.first?.summary, "Ölçüm: Kilo")
        XCTAssertEqual(kept.first?.body, Data(#"{"value":78.4}"#.utf8))
    }

    func testATimeoutIsKeptToo() async throws {
        let queue = SpyQueue()
        let slow = await client(ScriptedTransport(failure: .timedOut), queue: queue)

        _ = try? await slow.send(queueable)

        let kept = await queue.written()
        XCTAssertEqual(kept.count, 1)
    }

    /// Trying is how the app finds out it is online. A queue that skipped the
    /// attempt would delay every write behind a guess about the network.
    func testTheConnectionIsTriedBeforeAnythingIsQueued() async throws {
        let transport = ScriptedTransport(failure: .offline)
        let queue = SpyQueue()
        let offline = await client(transport, queue: queue)

        _ = try? await offline.send(queueable)

        let requests = await transport.sent()
        XCTAssertEqual(requests.count, 1)
    }

    // MARK: - What is not kept

    func testASuccessfulWriteIsNotQueued() async throws {
        let queue = SpyQueue()
        let live = await client(ScriptedTransport(), queue: queue)

        try await live.send(queueable)

        let kept = await queue.written()
        XCTAssertTrue(kept.isEmpty)
    }

    /// A server that says no has answered. Keeping the write would promise a
    /// delivery to a clinic that has already refused it.
    func testARefusedWriteIsNotQueued() async throws {
        let queue = SpyQueue()
        let refusing = await client(
            ScriptedTransport(
                answers: [
                    HTTPResponse(
                        status: 400,
                        body: Data(#"{"statusCode":400,"message":"Kilo 500 kg olamaz"}"#.utf8)
                    )
                ]
            ),
            queue: queue
        )

        do {
            try await refusing.send(queueable)
            XCTFail("A refused write is an error")
        } catch let error as APIError {
            guard case .validation(let body) = error else {
                return XCTFail("Expected the server's own message, got \(error)")
            }

            XCTAssertEqual(body.message, "Kilo 500 kg olamaz")
        }

        let kept = await queue.written()
        XCTAssertTrue(kept.isEmpty)
    }

    func testAnEndpointThatDidNotAskToBeQueuedIsNotQueued() async throws {
        let queue = SpyQueue()
        let offline = await client(ScriptedTransport(failure: .offline), queue: queue)
        let alarm = Endpoint(method: .post, path: "emergency", body: Data())

        do {
            try await offline.send(alarm)
            XCTFail("An alarm that cannot be raised is a failure, not a queued write")
        } catch let error as APIError {
            XCTAssertEqual(error, .offline)
        }

        let kept = await queue.written()
        XCTAssertTrue(kept.isEmpty)
    }

    func testAReadIsNeverQueued() async throws {
        let queue = SpyQueue()
        let offline = await client(ScriptedTransport(failure: .offline), queue: queue)

        _ = try? await offline.data(for: Endpoint(method: .get, path: "me/summary"))

        let kept = await queue.written()
        XCTAssertTrue(kept.isEmpty)
    }

    func testWithoutAQueueTheWriteFailsExactlyAsBefore() async throws {
        let offline = await client(ScriptedTransport(failure: .offline))

        do {
            try await offline.send(queueable)
            XCTFail("Nothing is holding the write")
        } catch let error as APIError {
            XCTAssertEqual(error, .offline)
        }
    }

    /// The queue is the only reason to claim the work is safe.
    func testAQueueThatCouldNotTakeItReportsTheOriginalFailure() async throws {
        let offline = await client(ScriptedTransport(failure: .offline), queue: SpyQueue(refuses: true))

        do {
            try await offline.send(queueable)
            XCTFail("The write is nowhere")
        } catch let error as APIError {
            XCTAssertEqual(error, .offline, "Saying it is saved when it is not is the worst answer")
        }
    }

    // MARK: - Sending it twice

    /// The dangerous case is not the request that never arrived. It is the one
    /// that arrived, committed, and lost its answer on the way back.
    func testTheSameKeyTravelsOnTheFirstAttemptAndOnTheReplay() async throws {
        let transport = ScriptedTransport(failure: .offline)
        let queue = SpyQueue()
        let offline = await client(transport, queue: queue)

        _ = try? await offline.send(queueable)

        let written = await queue.written()
        let kept = try XCTUnwrap(written.first)
        let sending = await client(transport, queue: queue)
        _ = await sending.replay(kept)

        let keys = await transport.sent().map { $0.value(forHTTPHeaderField: "Idempotency-Key") }
        XCTAssertEqual(keys.count, 2)
        XCTAssertEqual(keys[0], kept.id)
        XCTAssertEqual(keys[1], kept.id, "A replay under a new key would be a second record")
    }

    func testAReplayThatMeetsTheSameDeadConnectionDoesNotQueueACopy() async throws {
        let queue = SpyQueue()
        let offline = await client(ScriptedTransport(failure: .offline), queue: queue)

        _ = try? await offline.send(queueable)
        let written = await queue.written()
        let kept = try XCTUnwrap(written.first)

        _ = await offline.replay(kept)

        let afterReplay = await queue.written()
        XCTAssertEqual(afterReplay.count, 1, "The entry is already in the queue")
    }

    func testReplayReportsSuccess() async throws {
        let queue = SpyQueue()
        let offline = await client(ScriptedTransport(failure: .offline), queue: queue)
        _ = try? await offline.send(queueable)
        let written = await queue.written()
        let kept = try XCTUnwrap(written.first)

        let live = await client(ScriptedTransport(answers: [HTTPResponse(status: 201, body: Data())]))
        let result = await live.replay(kept)

        XCTAssertEqual(result, .succeeded)
    }

    /// The one case where the failure's body matters: it holds what the server
    /// has now, and the conflict screen shows it beside what the user wrote.
    func testReplayCarriesTheBodyOfAConflict() async throws {
        let queue = SpyQueue()
        let offline = await client(ScriptedTransport(failure: .offline), queue: queue)
        _ = try? await offline.send(queueable)
        let written = await queue.written()
        let kept = try XCTUnwrap(written.first)

        let conflictBody = Data(
            #"{"statusCode":409,"message":"VERSION_CONFLICT","currentVersion":4,"current":{"city":"Hamburg"}}"#.utf8
        )
        let refusing = await client(
            ScriptedTransport(answers: [HTTPResponse(status: 409, body: conflictBody)])
        )

        guard case .failed(let error, let body) = await refusing.replay(kept) else {
            return XCTFail("Expected a failure")
        }

        guard case .conflict = error else {
            return XCTFail("Expected a conflict, got \(error)")
        }

        XCTAssertEqual(body, conflictBody)
    }
}
