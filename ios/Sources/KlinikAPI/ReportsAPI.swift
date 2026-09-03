import Foundation
import KlinikCore

public enum RiskLevel: String, Decodable, Sendable, Equatable {
    case low = "LOW"
    case medium = "MEDIUM"
    case high = "HIGH"
    case critical = "CRITICAL"

    public var localizedName: String { L10n.string("report.risk.\(rawValue)") }

    /// Whether a clinician's list should mark this one out.
    public var needsAttention: Bool { self == .high || self == .critical }
}

/// The staff rendering: clinical text, the risk label, and who signed it off.
public struct AIReport: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let patientId: String
    public let source: String
    /// Clinical rendering, for staff.
    public let contentMd: String
    /// Plain-language rendering, for the patient.
    public let patientFacingMd: String?
    public let riskLevel: RiskLevel?
    public let model: String
    public let modelVersion: String?
    public let generatedAt: Date
    public let reviewedById: String?
    public let reviewedAt: Date?
    public let releasedToPatientAt: Date?
}

public struct ReportView: Decodable, Sendable, Equatable, Identifiable {
    public let report: AIReport
    /// The warning that goes under every AI output (spec M5).
    public let disclaimer: String
    public let visibleToPatient: Bool

    public var id: String { report.id }
    public var isReviewed: Bool { report.reviewedAt != nil }
}

/**
 * What the patient is given, which is a different document.
 *
 * There is no clinical text on it and no risk label — "CRITICAL" on a patient's
 * screen, with no clinician attached to it, is a verdict, and the server does
 * not send one.
 */
public struct PatientReport: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let source: String
    public let contentMd: String
    public let generatedAt: Date
    public let releasedAt: Date
    public let disclaimer: String
}

public struct ReportsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Only what a clinician released. The filter is the server's, not ours.
    public func mine() async throws -> [PatientReport] {
        try await client.send(Endpoint(method: .get, path: "me/reports"), as: [PatientReport].self)
    }

    public func pending() async throws -> [ReportView] {
        try await client.send(Endpoint(method: .get, path: "reports/pending"), as: [ReportView].self)
    }

    public func forPatient(_ patientId: String) async throws -> [ReportView] {
        try await client.send(
            Endpoint(method: .get, path: "patients/\(patientId)/reports"),
            as: [ReportView].self
        )
    }

    public func interpretLabs(patientId: String, documentId: String? = nil) async throws -> ReportView {
        try await client.send(
            Endpoint(
                method: .post,
                path: "patients/\(patientId)/reports/lab",
                query: documentId.map { ["documentId": $0] } ?? [:]
            ),
            as: ReportView.self
        )
    }

    /// Signing off, and deciding in the same action whether the patient sees it.
    public func review(_ reportId: String, release: Bool) async throws -> ReportView {
        try await client.send(
            Endpoint(
                method: .patch,
                path: "reports/\(reportId)/review",
                body: try JSONEncoder.klinik.encode(ReviewBody(release: release))
            ),
            as: ReportView.self
        )
    }

    private struct ReviewBody: Encodable {
        let release: Bool
    }
}
