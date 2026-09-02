import Foundation
import KlinikCore

public enum ComplicationStatus: String, Decodable, Sendable, Equatable {
    case reported = "REPORTED"
    case acknowledged = "ACKNOWLEDGED"
    case resolved = "RESOLVED"

    public var localizedName: String { L10n.string("complication.status.\(rawValue)") }
}

public struct Complication: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let patientId: String
    public let status: ComplicationStatus
    /// What the patient said, in their own words.
    public let note: String
    public let bodyArea: String?
    public let reportedAt: Date
    public let acknowledgedAt: Date?
    /// What the clinician answered.
    public let firstResponse: String?
    public let resolvedAt: Date?
    public let resolution: String?
}

public struct ComplicationView: Decodable, Sendable, Equatable, Identifiable {
    public let complication: Complication
    public let photos: [ClinicalPhoto]
    /// Minutes from report to first answer, or to now while still waiting.
    public let waitingMinutes: Int
    /// Nil until someone answered.
    public let responseMinutes: Int?
    /// Still unanswered past the clinic threshold.
    public let overdue: Bool

    public var id: String { complication.id }
}

public struct ComplicationsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    // MARK: - Patient side

    public func report(
        note: String,
        bodyArea: String?,
        photoIds: [String]
    ) async throws -> ComplicationView {
        try await client.send(
            Endpoint(
                method: .post,
                path: "me/complications",
                body: try JSONEncoder.klinik.encode(
                    ReportBody(note: note, bodyArea: bodyArea, photoIds: photoIds)
                )
            ),
            as: ComplicationView.self
        )
    }

    public func mine() async throws -> [ComplicationView] {
        try await client.send(
            Endpoint(method: .get, path: "me/complications"),
            as: [ComplicationView].self
        )
    }

    // MARK: - Clinician side

    public func queue(includeResolved: Bool = false) async throws -> [ComplicationView] {
        try await client.send(
            Endpoint(
                method: .get,
                path: "complications",
                query: includeResolved ? ["includeResolved": "true"] : [:]
            ),
            as: [ComplicationView].self
        )
    }

    public func acknowledge(id: String, message: String) async throws -> ComplicationView {
        try await respond(path: "complications/\(id)/acknowledge", message: message)
    }

    public func resolve(id: String, message: String) async throws -> ComplicationView {
        try await respond(path: "complications/\(id)/resolve", message: message)
    }

    private func respond(path: String, message: String) async throws -> ComplicationView {
        try await client.send(
            Endpoint(
                method: .patch,
                path: path,
                body: try JSONEncoder.klinik.encode(RespondBody(message: message))
            ),
            as: ComplicationView.self
        )
    }

    private struct ReportBody: Encodable {
        let note: String
        let bodyArea: String?
        let photoIds: [String]
    }

    private struct RespondBody: Encodable {
        let message: String
    }
}
