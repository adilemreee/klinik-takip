import XCTest
@testable import KlinikAPI

/// The envelope has to be exactly right: a boundary or a CRLF out of place and
/// the server rejects a file the patient may have taken some effort to send.
final class MultipartBodyTests: XCTestCase {
    private var scratch: URL!

    override func setUpWithError() throws {
        scratch = FileManager.default.temporaryDirectory
            .appendingPathComponent("klinik-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: scratch)
    }

    private func file(named name: String, contents: Data) throws -> URL {
        let url = scratch.appendingPathComponent(name)
        try contents.write(to: url)
        return url
    }

    func testWritesFieldsAndTheFilePart() throws {
        let source = try file(named: "result.pdf", contents: Data("%PDF-1.7 body".utf8))
        let body = MultipartBody(
            fields: ["type": "LAB"],
            fileURL: source,
            contentType: "application/pdf",
            boundary: "BOUND"
        )

        let envelope = try body.writeToTemporaryFile()
        defer { try? FileManager.default.removeItem(at: envelope) }

        let text = try String(contentsOf: envelope, encoding: .utf8)

        XCTAssertTrue(text.contains("--BOUND\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\nLAB\r\n"))
        XCTAssertTrue(
            text.contains(
                "Content-Disposition: form-data; name=\"file\"; filename=\"result.pdf\"\r\nContent-Type: application/pdf\r\n\r\n"
            )
        )
        XCTAssertTrue(text.contains("%PDF-1.7 body"))
        XCTAssertTrue(text.hasSuffix("\r\n--BOUND--\r\n"))
    }

    func testAnnouncesTheBoundaryInTheHeader() throws {
        let source = try file(named: "a.pdf", contents: Data("x".utf8))
        let body = MultipartBody(fileURL: source, boundary: "BOUND")

        XCTAssertEqual(body.headerValue, "multipart/form-data; boundary=BOUND")
    }

    func testDefaultsTheFilenameToTheFileOnDisk() throws {
        let source = try file(named: "scan.jpg", contents: Data("x".utf8))

        XCTAssertEqual(MultipartBody(fileURL: source).filename, "scan.jpg")
    }

    /// A quote in a filename would otherwise end the header field early.
    func testEscapesAFilenameThatWouldBreakTheHeader() throws {
        let source = try file(named: "ok.pdf", contents: Data("x".utf8))
        let body = MultipartBody(
            fileURL: source,
            filename: "re\"port\r\n.pdf",
            boundary: "BOUND"
        )

        let envelope = try body.writeToTemporaryFile()
        defer { try? FileManager.default.removeItem(at: envelope) }

        let text = try String(contentsOf: envelope, encoding: .utf8)

        XCTAssertTrue(text.contains("filename=\"re_port__.pdf\""))
    }

    /// The whole reason this writes to disk: a 20 MB scan must not be assembled
    /// in memory on a phone that is already holding the original.
    func testCopiesALargeFileWithoutHoldingItInMemory() throws {
        let large = Data(repeating: 0x41, count: 3 * 1024 * 1024)
        let source = try file(named: "big.bin", contents: large)
        let body = MultipartBody(fileURL: source, boundary: "BOUND")

        let envelope = try body.writeToTemporaryFile()
        defer { try? FileManager.default.removeItem(at: envelope) }

        let size = try FileManager.default.attributesOfItem(atPath: envelope.path)[.size] as? Int

        XCTAssertNotNil(size)
        XCTAssertGreaterThan(size!, large.count)
    }
}
