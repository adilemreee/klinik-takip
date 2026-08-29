import XCTest
import KlinikAPI
import KlinikCore
@testable import KlinikDocumentsFeature

/// Replies by path, and records what was asked for and what was uploaded.
private actor RecordingTransport: HTTPTransport {
    private var bodies: [String: (Int, String)]
    private(set) var paths: [String] = []
    private(set) var uploadedFrom: [URL] = []

    /**
     * Per-path delay.
     *
     * Without one the two calls in the concurrency tests do not actually
     * overlap: on a fast machine the first runs to completion — guard released
     * — before the second starts, and both succeed. That is not the situation
     * being tested, and it made the test pass locally and fail on CI.
     */
    private let delays: [String: Duration]

    init(bodies: [String: (Int, String)], delays: [String: Duration] = [:]) {
        self.bodies = bodies
        self.delays = delays
    }

    /// Lets a test change what the next list call returns, so a poll can be
    /// shown to pick up a status that has moved on.
    func setBody(_ path: String, _ value: (Int, String)) {
        bodies[path] = value
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        // Keyed by method as well as path: the same path lists and uploads, and
        // answering an upload with a list body would hide a decoding failure.
        let path = "\(request.httpMethod ?? "GET") \(request.url!.path)"
        paths.append(path)

        if let delay = delays[path] {
            try? await Task.sleep(for: delay)
        }

        guard let (status, body) = bodies[path] else {
            return HTTPResponse(status: 500, body: Data())
        }

        return HTTPResponse(status: status, body: Data(body.utf8))
    }

    func upload(_ request: URLRequest, fromFile fileURL: URL) async throws -> HTTPResponse {
        uploadedFrom.append(fileURL)
        return try await send(request)
    }

    func requestedPaths() -> [String] { paths }
    func uploads() -> [URL] { uploadedFrom }
}

private struct FailingTransport: HTTPTransport {
    let error: APIError
    func send(_ request: URLRequest) async throws -> HTTPResponse { throw error }
    func upload(_ request: URLRequest, fromFile fileURL: URL) async throws -> HTTPResponse {
        throw error
    }
}

private struct UnusedRefresher: TokenRefresher {
    func refresh(using refreshToken: String) async throws -> SessionTokens {
        throw APIError.unknown(status: 0)
    }
}

final class DocumentsModelTests: XCTestCase {
    private var scratch: URL!

    private func page(_ documents: [(String, String)], cursor: String? = nil) -> String {
        let items = documents.map { id, status in
            """
            {"id":"\(id)","type":"LAB","originalName":"r.pdf","mime":"application/pdf",
             "size":1024,"ocrStatus":"\(status)","createdAt":"2026-08-28T08:00:00.000Z"}
            """
        }.joined(separator: ",")

        return "{\"items\":[\(items)],\"nextCursor\":\(cursor.map { "\"\($0)\"" } ?? "null")}"
    }

    override func setUpWithError() throws {
        scratch = FileManager.default.temporaryDirectory
            .appendingPathComponent("klinik-doc-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: scratch)
    }

    private func model(_ transport: HTTPTransport) async -> DocumentsModel {
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
        return DocumentsModel(
            api: DocumentsAPI(client: client),
            resumable: ResumableUpload(client: client),
            patientId: "p1",
            // Everything in these tests is small; the resumable path has its
            // own suite.
            resumableThreshold: Int.max
        )
    }

    func testLoadsTheList() async {
        let documents = await model(
            RecordingTransport(bodies: ["GET /patients/p1/documents": (200, page([("d1", "DONE")]))])
        )

        await documents.load()

        let state = await documents.currentState()

        XCTAssertEqual(state.phase, .loaded)
        XCTAssertEqual(state.documents.map(\.id), ["d1"])
        XCTAssertEqual(state.documents.first?.ocrStatus, .done)
    }

    /// Nothing uploaded yet is not a failure and must not be shown as one.
    func testReportsEmptySeparatelyFromFailure() async {
        let documents = await model(
            RecordingTransport(bodies: ["GET /patients/p1/documents": (200, page([]))])
        )

        await documents.load()

        let phase = await documents.currentState().phase
        XCTAssertEqual(phase, .empty)
    }

    func testTreatsNotFoundAsItsOwnState() async {
        let documents = await model(
            FailingTransport(error: .notFound(ErrorResponse(statusCode: 404, message: "")))
        )

        await documents.load()

        let phase = await documents.currentState().phase
        XCTAssertEqual(phase, .notFound)
    }

    /// The file goes up from disk; the envelope is never a request body in memory.
    func testUploadsFromAFileAndReloads() async throws {
        let file = scratch.appendingPathComponent("r.pdf")
        try Data("%PDF-1.7".utf8).write(to: file)

        let created = """
        {"id":"d1","type":"LAB","originalName":"r.pdf","mime":"application/pdf",
         "size":1024,"ocrStatus":"QUEUED","createdAt":"2026-08-28T08:00:00.000Z",
         "jobId":"j1"}
        """

        let transport = RecordingTransport(bodies: [
            "POST /patients/p1/documents": (201, created),
            "GET /patients/p1/documents": (200, page([("d1", "QUEUED")])),
        ])
        let documents = await model(transport)

        let uploaded = await documents.upload(fileURL: file, type: .lab)
        let paths = await transport.requestedPaths()
        let uploads = await transport.uploads()

        XCTAssertTrue(uploaded)
        XCTAssertEqual(uploads.count, 1)
        // Reloaded from the server rather than guessing what was stored.
        XCTAssertEqual(paths, ["POST /patients/p1/documents", "GET /patients/p1/documents"])
    }

    /// A refused upload keeps the server's message, which says what was wrong
    /// with the file — ours would only say that something was.
    func testKeepsTheServerMessageWhenAnUploadIsRefused() async throws {
        let file = scratch.appendingPathComponent("r.pdf")
        try Data("x".utf8).write(to: file)

        let documents = await model(
            FailingTransport(
                error: .validation(
                    ErrorResponse(statusCode: 400, message: "File type not allowed here")
                )
            )
        )

        let uploaded = await documents.upload(fileURL: file, type: .lab)
        let error = await documents.currentState().uploadError

        XCTAssertFalse(uploaded)
        XCTAssertEqual(error, "File type not allowed here")
    }

    /// A double tap must not upload the same scan twice.
    func testRefusesASecondUploadWhileOneIsInFlight() async throws {
        let file = scratch.appendingPathComponent("r.pdf")
        try Data("%PDF-1.7".utf8).write(to: file)

        let created = """
        {"id":"d1","type":"LAB","originalName":"r.pdf","mime":"application/pdf",
         "size":1024,"ocrStatus":"QUEUED","createdAt":"2026-08-28T08:00:00.000Z",
         "jobId":"j1"}
        """

        let transport = RecordingTransport(
            bodies: [
                "POST /patients/p1/documents": (201, created),
                "GET /patients/p1/documents": (200, page([("d1", "QUEUED")])),
            ],
            // Held open so the second tap arrives while the first is still in
            // flight, which is the only way this is a double tap at all.
            delays: ["POST /patients/p1/documents": .milliseconds(200)]
        )
        let documents = await model(transport)

        async let first = documents.upload(fileURL: file, type: .lab)
        async let second = documents.upload(fileURL: file, type: .lab)

        let results = await [first, second]

        XCTAssertEqual(results.filter { $0 }.count, 1)
    }

    /// The point of polling: a document that finished processing has to stop
    /// saying "queued" without the user reloading the screen.
    func testPollingPicksUpAFinishedJob() async {
        let transport = RecordingTransport(bodies: [
            "GET /patients/p1/documents": (200, page([("d1", "QUEUED")])),
        ])
        let documents = await model(transport)

        await documents.load()
        await transport.setBody("GET /patients/p1/documents", (200, page([("d1", "DONE")])))
        await documents.refreshStatuses()

        let state = await documents.currentState()

        XCTAssertEqual(state.documents.first?.ocrStatus, .done)
        XCTAssertFalse(state.hasUnsettledWork)
    }

    /// Nothing outstanding means nothing to ask about; polling anyway is a
    /// request per screen per few seconds for no information.
    func testDoesNotPollWhenEverythingHasSettled() async {
        let transport = RecordingTransport(bodies: [
            "GET /patients/p1/documents": (200, page([("d1", "DONE")])),
        ])
        let documents = await model(transport)

        await documents.load()
        await documents.refreshStatuses()

        let paths = await transport.requestedPaths()

        XCTAssertEqual(paths, ["GET /patients/p1/documents"])
    }

    func testLoadsTheNextPage() async {
        let transport = RecordingTransport(bodies: [
            "GET /patients/p1/documents": (200, page([("d1", "DONE")], cursor: "d1")),
        ])
        let documents = await model(transport)

        await documents.load()
        let hasMore = await documents.currentState().hasMore
        XCTAssertTrue(hasMore)

        await transport.setBody("GET /patients/p1/documents", (200, page([("d2", "DONE")])))
        await documents.loadMore()

        let state = await documents.currentState()

        XCTAssertEqual(state.documents.map(\.id), ["d1", "d2"])
        XCTAssertFalse(state.hasMore)
    }
}
