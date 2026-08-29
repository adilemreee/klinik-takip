import XCTest
import KlinikCore
@testable import KlinikAPI

/// A server that loses a chunk, or loses a reply, the way a bad connection does.
private actor FlakyUploadServer: HTTPTransport {
    private var received: Data
    private(set) var patchCount = 0
    private(set) var statusCalls = 0

    /// Chunk indices to accept and then pretend never arrived — the reply is
    /// lost, so the client believes it succeeded and the server does not.
    private let dropReplies: Set<Int>
    init(dropReplies: Set<Int> = [], preloaded: Data = Data()) {
        self.dropReplies = dropReplies
        self.received = preloaded
    }

    private func session(status: String = "ACTIVE") -> Data {
        Data(
            """
            {"id":"s1","receivedBytes":\(received.count),"status":"\(status)",
             "mime":"application/pdf","expiresAt":"2026-12-31T00:00:00.000Z","documentId":null}
            """.utf8
        )
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        let path = request.url!.path

        if request.httpMethod == "PATCH" {
            let index = patchCount
            patchCount += 1

            let offset = Int(
                URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?
                    .queryItems?.first { $0.name == "offset" }?.value ?? "0"
            ) ?? 0

            if offset != received.count {
                return HTTPResponse(
                    status: 409,
                    body: Data("{\"message\":\"OFFSET_MISMATCH\"}".utf8)
                )
            }

            if dropReplies.contains(index) {
                // Accepted, but the client never hears so — it will retry the
                // same offset and must be told where the server really is.
                received.append(request.httpBody ?? Data())
                return HTTPResponse(status: 409, body: Data("{\"message\":\"lost\"}".utf8))
            }

            received.append(request.httpBody ?? Data())
            return HTTPResponse(status: 200, body: session())
        }

        if path.hasSuffix("/complete") {
            return HTTPResponse(
                status: 201,
                body: Data(
                    """
                    {"id":"d1","type":"LAB","originalName":"r.pdf","mime":"application/pdf",
                     "size":\(received.count),"ocrStatus":"QUEUED",
                     "createdAt":"2026-08-29T08:00:00.000Z","jobId":"j1"}
                    """.utf8
                )
            )
        }

        if request.httpMethod == "GET" {
            statusCalls += 1
            return HTTPResponse(status: 200, body: session())
        }

        return HTTPResponse(status: 201, body: session())
    }

    func bytes() -> Data { received }
    func patches() -> Int { patchCount }
    func statusRequests() -> Int { statusCalls }
}

private struct UnusedRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

final class ResumableUploadTests: XCTestCase {
    private var scratch: URL!

    override func setUpWithError() throws {
        scratch = FileManager.default.temporaryDirectory
            .appendingPathComponent("klinik-ru-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: scratch)
    }

    private func file(bytes: Int) throws -> URL {
        let url = scratch.appendingPathComponent("scan.pdf")
        var content = Data("%PDF-1.7\n".utf8)
        content.append(Data(repeating: 0x41, count: bytes - content.count))
        try content.write(to: url)
        return url
    }

    private func uploader(_ transport: HTTPTransport) async -> ResumableUpload {
        let session = SessionManager(store: InMemoryTokenStore(), refresher: UnusedRefresher())
        try? await session.signIn(
            with: SessionTokens(
                accessToken: "access",
                refreshToken: "refresh",
                expiresAt: Date().addingTimeInterval(900)
            )
        )
        return ResumableUpload(
            client: APIClient(
                configuration: APIConfiguration(baseURL: URL(string: "https://api.test")!),
                transport: transport,
                session: session
            )
        )
    }

    /// The bytes that arrive in pieces are the bytes that were on disk.
    func testSendsTheWholeFileInChunks() async throws {
        let source = try file(bytes: 3 * ResumableUpload.chunkSize + 512)
        let server = FlakyUploadServer()
        let upload = await uploader(server)

        _ = try await upload.send(fileURL: source, sessionId: "s1")

        let sent = await server.bytes()
        let patches = await server.patches()

        XCTAssertEqual(sent, try Data(contentsOf: source))
        XCTAssertEqual(patches, 4)
    }

    /**
     * The case the feature exists for: the client comes back with a stale idea
     * of how much arrived — an app relaunched, an attempt from an hour ago —
     * and the server is ahead of it. The client asks rather than guessing,
     * because guessing leaves a hole in the file that nothing downstream
     * notices until a doctor opens a corrupt PDF.
     */
    func testResumesWhenTheServerIsAheadOfTheClient() async throws {
        let source = try file(bytes: 3 * ResumableUpload.chunkSize)
        let content = try Data(contentsOf: source)

        // The server already holds the first chunk from an earlier attempt.
        let server = FlakyUploadServer(
            preloaded: content.prefix(ResumableUpload.chunkSize)
        )
        let upload = await uploader(server)

        _ = try await upload.send(fileURL: source, sessionId: "s1", from: 0)

        let sent = await server.bytes()
        let statusCalls = await server.statusRequests()

        XCTAssertEqual(sent, content)
        XCTAssertGreaterThanOrEqual(statusCalls, 1)
    }

    /**
     * A reply lost in transit is the nastiest case: the server has the chunk
     * and the client does not know. Re-sending blindly would duplicate it, so
     * the client re-reads the offset and skips ahead.
     */
    func testDoesNotDuplicateAChunkWhoseReplyWasLost() async throws {
        let source = try file(bytes: 2 * ResumableUpload.chunkSize)
        let server = FlakyUploadServer(dropReplies: [0])
        let upload = await uploader(server)

        _ = try await upload.send(fileURL: source, sessionId: "s1")

        let sent = await server.bytes()

        XCTAssertEqual(sent, try Data(contentsOf: source))
        XCTAssertEqual(sent.count, 2 * ResumableUpload.chunkSize)
    }

    /// Resuming sends the remainder, not the file again — which is the entire
    /// saving.
    func testSendsOnlyTheRemainderWhenResuming() async throws {
        let source = try file(bytes: 3 * ResumableUpload.chunkSize)
        let content = try Data(contentsOf: source)
        let server = FlakyUploadServer(
            preloaded: content.prefix(2 * ResumableUpload.chunkSize)
        )
        let upload = await uploader(server)

        _ = try await upload.send(
            fileURL: source,
            sessionId: "s1",
            from: 2 * ResumableUpload.chunkSize
        )

        let patches = await server.patches()
        let sent = await server.bytes()

        XCTAssertEqual(patches, 1)
        XCTAssertEqual(sent, content)
    }

    func testReportsProgressAsItGoes() async throws {
        let source = try file(bytes: 3 * ResumableUpload.chunkSize)
        let server = FlakyUploadServer()
        let upload = await uploader(server)

        let recorded = Recorder()
        _ = try await upload.send(fileURL: source, sessionId: "s1") { progress in
            recorded.add(progress.fraction)
        }

        let fractions = recorded.values()

        XCTAssertEqual(fractions.count, 3)
        XCTAssertEqual(try XCTUnwrap(fractions.last), 1.0, accuracy: 0.0001)
    }

    /// Hashed in chunks so a 20 MB file is never resident in memory.
    func testChecksumMatchesTheFileOnDisk() async throws {
        let source = try file(bytes: 300_000)

        let computed = try ResumableUpload.checksum(of: source)
        let expected = try Data(contentsOf: source).sha256Hex()

        XCTAssertEqual(computed, expected)
    }
}

/// Collects callback values from a non-isolated closure.
private final class Recorder: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [Double] = []

    func add(_ value: Double) {
        lock.lock()
        recorded.append(value)
        lock.unlock()
    }

    func values() -> [Double] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }
}

import CryptoKit

private extension Data {
    func sha256Hex() -> String {
        SHA256.hash(data: self).map { String(format: "%02x", $0) }.joined()
    }
}
