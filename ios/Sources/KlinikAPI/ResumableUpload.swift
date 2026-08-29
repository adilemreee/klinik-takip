import CryptoKit
import Foundation
import KlinikCore

public struct UploadSession: Decodable, Sendable, Equatable {
    public let id: String
    /// The offset to send next. The whole protocol turns on this number.
    public let receivedBytes: Int
    public let status: String
    public let mime: String?
    public let expiresAt: Date
    public let documentId: String?
}

/// How much of a file has reached the server, for a progress bar.
public struct UploadProgress: Sendable, Equatable {
    public let sent: Int
    public let total: Int

    public var fraction: Double { total == 0 ? 0 : Double(sent) / Double(total) }
}

/// Chunked, resumable upload (spec section 9).
///
/// Single-shot upload is fine on the clinic's own network. It is not fine for
/// the patient this product is for: abroad, on mobile data, sending a 20 MB
/// scan. Losing the connection at 18 MB and starting over is how a document
/// ends up never being sent.
public struct ResumableUpload: Sendable {
    /// One megabyte: small enough that losing one costs little on a bad
    /// connection, large enough that a 20 MB file is twenty requests and not
    /// two thousand.
    public static let chunkSize = 1024 * 1024

    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func begin(
        patientId: String,
        type: DocumentType,
        originalName: String?
    ) async throws -> UploadSession {
        try await client.send(
            Endpoint(
                method: .post,
                path: "patients/\(patientId)/documents/uploads",
                body: try JSONEncoder.klinik.encode(
                    BeginBody(type: type.rawValue, originalName: originalName)
                )
            ),
            as: UploadSession.self
        )
    }

    public func status(sessionId: String) async throws -> UploadSession {
        try await client.send(
            Endpoint(method: .get, path: "documents/uploads/\(sessionId)"),
            as: UploadSession.self
        )
    }

    /// Sends the file from `offset` onwards, resuming after interruptions.
    ///
    /// A rejected offset is not treated as an error to surface: the server
    /// knows how much it has, so the client asks and carries on from there.
    /// Guessing instead would leave a hole in the file that nothing downstream
    /// would notice until a doctor opened a corrupt PDF.
    @discardableResult
    public func send(
        fileURL: URL,
        sessionId: String,
        from startOffset: Int = 0,
        onProgress: (@Sendable (UploadProgress) -> Void)? = nil
    ) async throws -> UploadSession {
        let total = try fileSize(of: fileURL)
        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { try? handle.close() }

        var offset = startOffset
        var session: UploadSession?

        while offset < total {
            try handle.seek(toOffset: UInt64(offset))
            let chunk = try handle.read(upToCount: Self.chunkSize) ?? Data()

            if chunk.isEmpty { break }

            do {
                session = try await client.send(
                    Endpoint(
                        method: .patch,
                        path: "documents/uploads/\(sessionId)",
                        query: ["offset": String(offset)],
                        body: chunk,
                        contentType: "application/octet-stream"
                    ),
                    as: UploadSession.self
                )
                offset += chunk.count
            } catch let error as APIError {
                guard case .conflict = error else { throw error }

                // The server is somewhere else — behind us if a chunk was lost,
                // ahead if a success reply was. Either way it is the authority.
                let current = try await status(sessionId: sessionId)
                session = current

                guard current.receivedBytes != offset else { throw error }

                offset = current.receivedBytes
                continue
            }

            onProgress?(UploadProgress(sent: offset, total: total))
        }

        if let session { return session }

        return try await status(sessionId: sessionId)
    }

    /// Completes the upload, checked against a hash of the file on disk.
    ///
    /// The server hashes what arrived; this hashes what was read. A mismatch
    /// means the assembled file is not the one the patient chose, and the
    /// server refuses it rather than filing a corrupt document.
    public func complete(sessionId: String, fileURL: URL) async throws -> UploadedDocument {
        try await client.send(
            Endpoint(
                method: .post,
                path: "documents/uploads/\(sessionId)/complete",
                body: try JSONEncoder.klinik.encode(
                    CompleteBody(checksum: try Self.checksum(of: fileURL))
                )
            ),
            as: UploadedDocument.self
        )
    }

    public func abort(sessionId: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "documents/uploads/\(sessionId)"))
    }

    /// Hashed in chunks: a 20 MB file must not be resident in memory just to
    /// be measured.
    static func checksum(of fileURL: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { try? handle.close() }

        var hasher = SHA256()

        while let chunk = try handle.read(upToCount: 256 * 1024), !chunk.isEmpty {
            hasher.update(data: chunk)
        }

        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func fileSize(of fileURL: URL) throws -> Int {
        let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        return (attributes[.size] as? Int) ?? 0
    }

    private struct BeginBody: Encodable {
        let type: String
        let originalName: String?
    }

    private struct CompleteBody: Encodable {
        let checksum: String
    }
}
