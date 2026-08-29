import Foundation

/// A multipart/form-data body, written to a file rather than held in memory.
///
/// A clinical document can be 20 MB. Building that in memory on a phone, on top
/// of whatever the camera or file picker is already holding, is how an upload
/// screen gets killed by the system just as the patient finally sends the scan
/// the clinic has been asking for. The envelope is assembled on disk and handed
/// to URLSession, which streams it.
public struct MultipartBody: Sendable {
    public let boundary: String
    public let fields: [String: String]
    public let fileField: String
    public let fileURL: URL
    public let filename: String
    public let contentType: String

    public init(
        fields: [String: String] = [:],
        fileField: String = "file",
        fileURL: URL,
        filename: String? = nil,
        contentType: String = "application/octet-stream",
        boundary: String = "klinik-\(UUID().uuidString)"
    ) {
        self.fields = fields
        self.fileField = fileField
        self.fileURL = fileURL
        self.filename = filename ?? fileURL.lastPathComponent
        self.contentType = contentType
        self.boundary = boundary
    }

    public var headerValue: String { "multipart/form-data; boundary=\(boundary)" }

    /// Assembles the envelope on disk. The caller deletes the result when done.
    ///
    /// Every line ends CRLF, spelled out rather than produced by rewriting a
    /// Swift multi-line literal: that trick turns an escaped \r into \r\r\n and
    /// produces a body servers reject for reasons that are miserable to find.
    public func writeToTemporaryFile() throws -> URL {
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("upload-\(UUID().uuidString).tmp")

        FileManager.default.createFile(atPath: destination.path, contents: nil)

        let handle = try FileHandle(forWritingTo: destination)
        defer { try? handle.close() }

        func writeLines(_ lines: [String]) throws {
            try handle.write(contentsOf: Data(lines.map { "\($0)\r\n" }.joined().utf8))
        }

        // Sorted so the same upload produces the same body, which is what makes
        // it reproducible in a test and in a captured request.
        for (name, value) in fields.sorted(by: { $0.key < $1.key }) {
            try writeLines([
                "--\(boundary)",
                "Content-Disposition: form-data; name=\"\(escaped(name))\"",
                "",
                value,
            ])
        }

        try writeLines([
            "--\(boundary)",
            "Content-Disposition: form-data; name=\"\(escaped(fileField))\"; filename=\"\(escaped(filename))\"",
            "Content-Type: \(contentType)",
            "",
        ])

        // Copied in chunks so the file is never resident in memory in full.
        let source = try FileHandle(forReadingFrom: fileURL)
        defer { try? source.close() }

        while let chunk = try source.read(upToCount: 256 * 1024), !chunk.isEmpty {
            try handle.write(contentsOf: chunk)
        }

        try writeLines(["", "--\(boundary)--"])

        return destination
    }

    /// Keeps a filename from breaking out of the header it sits in.
    private func escaped(_ name: String) -> String {
        name.replacingOccurrences(of: "\"", with: "_")
            .replacingOccurrences(of: "\r", with: "_")
            .replacingOccurrences(of: "\n", with: "_")
    }
}
