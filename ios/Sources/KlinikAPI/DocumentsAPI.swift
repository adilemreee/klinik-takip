import Foundation
import KlinikCore

public enum DocumentType: String, Decodable, Sendable, CaseIterable {
    case lab = "LAB"
    case imaging = "IMAGING"
    case report = "REPORT"
    case consent = "CONSENT"
    case invoice = "INVOICE"
    case passport = "PASSPORT"
    case ecg = "ECG"
    case other = "OTHER"

    public var localizedName: String { L10n.string("document.type.\(rawValue)") }
}

/// Where a piece of queued work has got to.
///
/// QUEUED covers "waiting for its first attempt" and "waiting for a retry"
/// alike, which is what the person looking at the screen needs to know: it is
/// still going to happen.
public enum ProcessingStatus: String, Decodable, Sendable {
    case pending = "PENDING"
    case queued = "QUEUED"
    case processing = "PROCESSING"
    case done = "DONE"
    case failed = "FAILED"
    case skipped = "SKIPPED"

    public var localizedName: String { L10n.string("job.status.\(rawValue)") }

    /// Whether the clinic still expects this to finish on its own.
    public var isSettled: Bool { self == .done || self == .failed || self == .skipped }
}

public struct ClinicalDocument: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let type: DocumentType
    public let originalName: String?
    /// Detected from the bytes at upload, not from what was declared.
    public let mime: String
    public let size: Int
    public let ocrStatus: ProcessingStatus
    public let createdAt: Date

    public var displayName: String { originalName ?? type.localizedName }
}

public struct DocumentPage: Decodable, Sendable {
    public let items: [ClinicalDocument]
    /// Null on the last page.
    public let nextCursor: String?
}

public struct UploadedDocument: Decodable, Sendable {
    public let id: String
    public let type: DocumentType
    public let originalName: String?
    public let mime: String
    public let size: Int
    public let ocrStatus: ProcessingStatus
    public let createdAt: Date
    /// The processing job queued for this upload.
    public let jobId: String
}

public struct JobRecord: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let queue: String
    public let name: String
    public let status: ProcessingStatus
    public let attempts: Int
    /// Safe to show staff; never carries file contents.
    public let error: String?
    public let startedAt: Date?
    public let finishedAt: Date?
    public let createdAt: Date
}

public struct DownloadLink: Decodable, Sendable {
    public let url: String
    public let expiresAt: Date
    public let filename: String
}

public struct DocumentsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func list(
        subject: RecordSubject,
        type: DocumentType? = nil,
        cursor: String? = nil,
        limit: Int? = nil
    ) async throws -> DocumentPage {
        var query: [String: String] = [:]
        if let type { query["type"] = type.rawValue }
        if let cursor { query["cursor"] = cursor }
        if let limit { query["limit"] = String(limit) }

        return try await client.send(
            Endpoint(method: .get, path: subject.base("documents"), query: query),
            as: DocumentPage.self
        )
    }

    /// Streams the file from disk; nothing is held in memory (see MultipartBody).
    public func upload(
        subject: RecordSubject,
        fileURL: URL,
        type: DocumentType,
        contentType: String = "application/octet-stream"
    ) async throws -> UploadedDocument {
        try await client.upload(
            Endpoint(method: .post, path: subject.base("documents")),
            multipart: MultipartBody(
                fields: ["type": type.rawValue],
                fileURL: fileURL,
                contentType: contentType
            ),
            as: UploadedDocument.self
        )
    }

    public func jobs(documentId: String) async throws -> [JobRecord] {
        try await client.send(
            Endpoint(method: .get, path: "documents/\(documentId)/jobs"),
            as: [JobRecord].self
        )
    }

    /// A fresh link each time: they are short-lived and are never stored.
    public func downloadLink(documentId: String) async throws -> DownloadLink {
        try await client.send(
            Endpoint(method: .get, path: "documents/\(documentId)/download"),
            as: DownloadLink.self
        )
    }

    public func remove(documentId: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "documents/\(documentId)"))
    }
}
