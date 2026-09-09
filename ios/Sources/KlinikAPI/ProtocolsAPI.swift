import Foundation
import KlinikCore

/// A document the assistant is allowed to quote (spec M4).
public struct ProtocolDocument: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    /// Restricts retrieval to patients who had this procedure. Nil means every
    /// patient, which is right for a general FAQ and wrong for a discharge
    /// instruction that belongs to one operation.
    public let procedureType: String?
    public let language: String
    public let content: String
    public let version: Int
    public let isActive: Bool
    public let createdAt: Date
}

public struct ProtocolSummary: Decodable, Sendable, Equatable, Identifiable {
    public let document: ProtocolDocument
    /// How many passages it was split into. Zero means the assistant has
    /// nothing to retrieve from it.
    public let chunks: Int
    /// False when no embedding provider was configured at upload time — the
    /// document is stored and the assistant cannot find it.
    public let embedded: Bool

    public var id: String { document.id }

    /// Whether this document can actually answer anything today.
    public var isUsable: Bool { document.isActive && embedded && chunks > 0 }
}

public struct ProtocolsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func list(includeInactive: Bool = false) async throws -> [ProtocolSummary] {
        try await client.send(
            Endpoint(
                method: .get,
                path: "protocols",
                query: includeInactive ? ["includeInactive": "true"] : [:]
            ),
            as: [ProtocolSummary].self
        )
    }

    public func upload(
        title: String,
        content: String,
        procedureType: String?,
        language: String
    ) async throws -> ProtocolSummary {
        try await client.send(
            Endpoint(
                method: .post,
                path: "protocols",
                body: try JSONEncoder.klinik.encode(
                    UploadBody(
                        title: title,
                        content: content,
                        procedureType: procedureType,
                        language: language
                    )
                )
            ),
            as: ProtocolSummary.self
        )
    }

    /// Retires a document. The assistant stops quoting it; the record stays,
    /// because an answer it gave last week was given from something.
    public func retire(_ documentId: String) async throws -> ProtocolDocument {
        try await client.send(
            Endpoint(method: .delete, path: "protocols/\(documentId)"),
            as: ProtocolDocument.self
        )
    }

    private struct UploadBody: Encodable {
        let title: String
        let content: String
        let procedureType: String?
        let language: String
    }
}
