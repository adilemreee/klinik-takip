import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikSync

/// Answers the three calls the resumable protocol makes, and remembers them.
private actor ScriptedTransport: HTTPTransport {
    enum Behaviour: Sendable {
        case succeed
        /// Chunks fail; the session opens fine. A connection that dies mid-transfer.
        case dropDuringTransfer
        case sessionForgotten
        case refuse
    }

    private let behaviour: Behaviour
    private(set) var calls: [String] = []
    private var openedSessions = 0

    init(behaviour: Behaviour = .succeed) {
        self.behaviour = behaviour
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let method = request.httpMethod ?? "GET"
        let path = request.url!.path
        calls.append("\(method) \(path)")

        if behaviour == .refuse {
            return HTTPResponse(
                status: 400,
                body: Data(#"{"statusCode":400,"message":"Bu dosya türü kabul edilmiyor"}"#.utf8)
            )
        }

        // Opening a session.
        if method == "POST", path.hasSuffix("documents/uploads") {
            openedSessions += 1
            return HTTPResponse(status: 201, body: Data(session(id: "s\(openedSessions)", received: 0).utf8))
        }

        // Asking where the server got to.
        if method == "GET", path.contains("documents/uploads/") {
            if behaviour == .sessionForgotten {
                return HTTPResponse(
                    status: 404,
                    body: Data(#"{"statusCode":404,"message":"gone"}"#.utf8)
                )
            }

            return HTTPResponse(status: 200, body: Data(session(id: "s\(openedSessions)", received: 0).utf8))
        }

        if method == "PATCH" {
            if behaviour == .dropDuringTransfer { throw APIError.offline }

            return HTTPResponse(status: 200, body: Data(session(id: "s\(openedSessions)", received: 4).utf8))
        }

        // Completing.
        return HTTPResponse(
            status: 201,
            body: Data(
                #"{"id":"d1","type":"LAB","originalName":"tahlil.pdf","mime":"application/pdf","size":4,"ocrStatus":"QUEUED","createdAt":"2026-01-02T08:00:00.000Z","jobId":"j1"}"#.utf8
            )
        )
    }

    private func session(id: String, received: Int) -> String {
        """
        {"id":"\(id)","receivedBytes":\(received),"status":"OPEN","mime":null,\
        "expiresAt":"2030-01-02T08:00:00.000Z","documentId":null}
        """
    }

    func made() -> [String] { calls }
}

private struct UnusedRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

/**
 * Files that outlive the connection that failed to carry them (spec M15).
 *
 * The write outbox carries requests; this carries bytes, which is a different
 * problem. Twenty megabytes has to survive the app being killed, resume from
 * wherever the server got to, and still be the same file when it is assembled.
 */
final class UploadQueueTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private func chosenFile(named name: String = "tahlil.pdf") throws -> URL {
        let url = directory.appendingPathComponent(name)
        try Data("scan".utf8).write(to: url)
        return url
    }

    private func queue(
        _ behaviour: ScriptedTransport.Behaviour = .succeed,
        store: UploadStore = InMemoryUploadStore()
    ) async -> (UploadQueue, ScriptedTransport, UploadStore) {
        let transport = ScriptedTransport(behaviour: behaviour)
        let session = SessionManager(store: InMemoryTokenStore(), refresher: UnusedRefresher())
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

        return (
            UploadQueue(store: store, uploads: ResumableUpload(client: client)),
            transport,
            store
        )
    }

    // MARK: - Taking custody

    /// The picker hands over something in the temporary directory, which the
    /// system empties whenever it likes. An upload with no bytes left to send
    /// is not resumable, it is lost.
    func testTheFileIsCopiedSomewhereTheAppOwns() async throws {
        let (uploads, _, _) = await queue()
        let chosen = try chosenFile()

        let kept = try await uploads.accept(
            fileURL: chosen,
            subject: .me,
            type: .lab,
            contentType: "application/pdf"
        )

        XCTAssertNotEqual(kept.fileURL, chosen)
        XCTAssertTrue(kept.fileExists)

        // Deleting what the picker gave us must not empty the queue.
        try FileManager.default.removeItem(at: chosen)
        XCTAssertTrue(kept.fileExists)

        await uploads.discard(id: kept.id)
    }

    func testAFileChosenWithNoServerHasNoSessionYet() async throws {
        let (uploads, _, _) = await queue()

        let kept = try await uploads.accept(
            fileURL: try chosenFile(),
            subject: .me,
            type: .lab,
            contentType: "application/pdf"
        )

        XCTAssertNil(kept.sessionId, "There was no server to open one with")

        await uploads.discard(id: kept.id)
    }

    // MARK: - Sending

    func testSendingOpensASessionAndCompletesIt() async throws {
        let (uploads, transport, store) = await queue()
        let kept = try await uploads.accept(
            fileURL: try chosenFile(),
            subject: .me,
            type: .lab,
            contentType: "application/pdf"
        )

        let outcome = await uploads.send(kept)

        XCTAssertEqual(outcome, .finished)

        let remaining = try await store.unfinished()
        XCTAssertTrue(remaining.isEmpty)

        let calls = await transport.made()
        XCTAssertEqual(calls.first, "POST /me/documents/uploads")
        XCTAssertTrue(calls.contains { $0.hasPrefix("POST /documents/uploads/") })
    }

    /// The clinic has it now; a second copy on the phone is one person's
    /// medical record taking up space in a directory nobody looks at.
    func testTheCopyIsRemovedOnceTheClinicHasIt() async throws {
        let (uploads, _, _) = await queue()
        let kept = try await uploads.accept(
            fileURL: try chosenFile(),
            subject: .me,
            type: .lab,
            contentType: "application/pdf"
        )

        _ = await uploads.send(kept)

        XCTAssertFalse(kept.fileExists)
    }

    func testAConnectionThatDiesLeavesTheFileQueued() async throws {
        let (uploads, _, store) = await queue(.dropDuringTransfer)
        let kept = try await uploads.accept(
            fileURL: try chosenFile(),
            subject: .me,
            type: .lab,
            contentType: "application/pdf"
        )

        let outcome = await uploads.send(kept)

        guard case .retryable = outcome else {
            return XCTFail("Expected retryable, got \(outcome)")
        }

        let remaining = try await store.unfinished()
        XCTAssertEqual(remaining.count, 1)
        XCTAssertEqual(remaining.first?.attempts, 1)
        XCTAssertTrue(remaining.first?.fileExists ?? false, "The bytes are still here")

        await uploads.discard(id: kept.id)
    }

    /// A session the server has forgotten is not a failure to report — the file
    /// is still on the phone, so a new session is opened and it starts again.
    func testAForgottenSessionIsReplacedRatherThanReported() async throws {
        let (uploads, transport, _) = await queue(.sessionForgotten)
        var kept = try await uploads.accept(
            fileURL: try chosenFile(),
            subject: .me,
            type: .lab,
            contentType: "application/pdf"
        )
        kept.sessionId = "expired-session"

        let outcome = await uploads.send(kept)

        XCTAssertEqual(outcome, .finished)

        let calls = await transport.made()
        XCTAssertTrue(
            calls.contains("POST /me/documents/uploads"),
            "A new session was opened rather than the upload being abandoned"
        )
    }

    /// A refused type will never succeed. Retrying it forever would hide the
    /// one thing the patient has to be told.
    func testARefusedFileIsNotRetriedForever() async throws {
        let (uploads, _, store) = await queue(.refuse)
        let kept = try await uploads.accept(
            fileURL: try chosenFile(),
            subject: .me,
            type: .lab,
            contentType: "application/pdf"
        )

        let outcome = await uploads.send(kept)

        guard case .rejected(let message) = outcome else {
            return XCTFail("Expected rejected, got \(outcome)")
        }

        XCTAssertEqual(message, "Bu dosya türü kabul edilmiyor")

        // Kept, so the person can be told and can decide.
        let remaining = try await store.unfinished()
        XCTAssertEqual(remaining.count, 1)

        await uploads.discard(id: kept.id)
    }

    func testAFileThatIsNoLongerOnThePhoneSaysSoRatherThanRetrying() async throws {
        let (uploads, transport, _) = await queue()
        let kept = try await uploads.accept(
            fileURL: try chosenFile(),
            subject: .me,
            type: .lab,
            contentType: "application/pdf"
        )
        try FileManager.default.removeItem(at: kept.fileURL)

        let outcome = await uploads.send(kept)

        XCTAssertEqual(outcome, .fileMissing)

        let calls = await transport.made()
        XCTAssertTrue(calls.isEmpty, "There is nothing to send, so nothing is sent")

        await uploads.discard(id: kept.id)
    }

    // MARK: - Draining

    /// The same dead connection is about to meet every other file; walking the
    /// rest would spend the battery of somebody who has no signal.
    func testDrainingStopsAtTheFirstConnectivityFailure() async throws {
        let (uploads, transport, _) = await queue(.dropDuringTransfer)

        for name in ["bir.pdf", "iki.pdf", "uc.pdf"] {
            _ = try await uploads.accept(
                fileURL: try chosenFile(named: name),
                subject: .me,
                type: .lab,
                contentType: "application/pdf"
            )
        }

        _ = await uploads.drain()

        let opened = await transport.made().filter { $0 == "POST /me/documents/uploads" }
        XCTAssertEqual(opened.count, 1, "Only the first file was attempted")

        await uploads.discardEverything()
    }

    func testDrainingSendsEverythingWhenTheConnectionHolds() async throws {
        let (uploads, _, store) = await queue()

        for name in ["bir.pdf", "iki.pdf"] {
            _ = try await uploads.accept(
                fileURL: try chosenFile(named: name),
                subject: .me,
                type: .lab,
                contentType: "application/pdf"
            )
        }

        let sent = await uploads.drain()

        XCTAssertEqual(sent, 2)

        let remaining = try await store.unfinished()
        XCTAssertTrue(remaining.isEmpty)
    }

    // MARK: - Giving up on purpose

    func testDiscardingRemovesTheRowAndTheBytes() async throws {
        let (uploads, _, store) = await queue()
        let kept = try await uploads.accept(
            fileURL: try chosenFile(),
            subject: .me,
            type: .lab,
            contentType: "application/pdf"
        )

        await uploads.discard(id: kept.id)

        let remaining = try await store.unfinished()
        XCTAssertTrue(remaining.isEmpty)
        XCTAssertFalse(kept.fileExists)
    }

    /// The files are one person's medical documents in a directory this app
    /// owns. Leaving them for the next account is worse than losing them.
    func testSigningOutTakesTheFilesToo() async throws {
        let (uploads, _, store) = await queue()
        let kept = try await uploads.accept(
            fileURL: try chosenFile(),
            subject: .me,
            type: .lab,
            contentType: "application/pdf"
        )

        await uploads.discardEverything()

        let remaining = try await store.unfinished()
        XCTAssertTrue(remaining.isEmpty)
        XCTAssertFalse(kept.fileExists)
    }
}
