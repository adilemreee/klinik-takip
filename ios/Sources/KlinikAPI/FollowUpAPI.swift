import Foundation
import KlinikCore

public enum MilestoneStatus: String, Decodable, Encodable, Sendable, Equatable {
    case pending = "PENDING"
    case notified = "NOTIFIED"
    case completed = "COMPLETED"
    case missed = "MISSED"
    case skipped = "SKIPPED"

    public var localizedName: String { L10n.string("followUp.status.\(rawValue)") }

    /// Whether the clinic is still waiting for this visit to happen.
    public var isOutstanding: Bool { self == .pending || self == .notified || self == .missed }
}

public struct Milestone: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    /// D1, W1, M1… — the same labels the photo gallery uses for its phases.
    public let label: String
    public let dueAt: Date
    public let status: MilestoneStatus
    public let notifiedAt: Date?
    public let completedAt: Date?

    public var localizedLabel: String { L10n.string("followUp.milestone.\(label)") }
}

public struct FollowUpSchedule: Decodable, Sendable, Equatable {
    public let id: String
    public let patientId: String
    public let surgeryDate: Date
    public let template: String?
    /// Soonest first.
    public let milestones: [Milestone]

    public init(
        id: String,
        patientId: String,
        surgeryDate: Date,
        template: String?,
        milestones: [Milestone]
    ) {
        self.id = id
        self.patientId = patientId
        self.surgeryDate = surgeryDate
        self.template = template
        self.milestones = milestones
    }

    /// The next visit still ahead, which is what a patient opens this for.
    public func next(after now: Date = Date()) -> Milestone? {
        milestones.first { $0.dueAt >= now && $0.status.isOutstanding }
    }

    public var missed: [Milestone] { milestones.filter { $0.status == .missed } }
}

/// The endpoint answers with an empty object when no schedule exists yet.
private struct OptionalSchedule: Decodable, Sendable {
    let value: FollowUpSchedule?

    init(from decoder: Decoder) throws {
        value = try? FollowUpSchedule(from: decoder)
    }
}

public struct FollowUpAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func mine() async throws -> FollowUpSchedule? {
        try await client.send(Endpoint(method: .get, path: "me/follow-up"), as: OptionalSchedule.self)
            .value
    }

    public func forPatient(_ patientId: String) async throws -> FollowUpSchedule? {
        try await client.send(
            Endpoint(method: .get, path: "patients/\(patientId)/follow-up"),
            as: OptionalSchedule.self
        ).value
    }

    public func generate(
        patientId: String,
        surgeryDate: Date,
        template: String? = nil,
        timezone: String? = nil
    ) async throws -> FollowUpSchedule {
        try await client.send(
            Endpoint(
                method: .post,
                path: "patients/\(patientId)/follow-up",
                body: try JSONEncoder.klinik.encode(
                    GenerateBody(surgeryDate: surgeryDate, template: template, timezone: timezone)
                )
            ),
            as: FollowUpSchedule.self
        )
    }

    public func setStatus(milestoneId: String, status: MilestoneStatus) async throws -> Milestone {
        try await client.send(
            Endpoint(
                method: .patch,
                path: "follow-up/milestones/\(milestoneId)",
                body: try JSONEncoder.klinik.encode(StatusBody(status: status))
            ),
            as: Milestone.self
        )
    }

    private struct GenerateBody: Encodable {
        let surgeryDate: Date
        let template: String?
        let timezone: String?
    }

    private struct StatusBody: Encodable {
        let status: MilestoneStatus
    }
}
