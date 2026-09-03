import Foundation
import KlinikCore

/// What a clinician should look at first, and why.
public enum RiskKind: String, Decodable, Sendable, Equatable, CaseIterable {
    case emergencyUnanswered = "emergency-unanswered"
    case messageUrgent = "message-urgent"
    case complicationOverdue = "complication-overdue"
    case followUpMissed = "follow-up-missed"
    case reportUnreviewed = "report-unreviewed"

    public var localizedName: String { L10n.string("briefing.risk.\(rawValue)") }
}

public struct RiskItem: Decodable, Sendable, Equatable, Identifiable {
    public let patientId: String
    public let patientName: String
    public let kind: RiskKind
    /// What is waiting. Never the patient's own words.
    public let detail: String
    public let waitingMinutes: Int

    public var id: String { "\(patientId)-\(kind.rawValue)-\(waitingMinutes)" }

    /// Minutes for the first hour, then hours — a doctor does not read "4,320".
    public var localizedWaiting: String {
        waitingMinutes < 60
            ? String(format: L10n.string("briefing.waitingMinutes"), waitingMinutes)
            : String(format: L10n.string("briefing.waitingHours"), waitingMinutes / 60)
    }
}

public struct BriefingYesterday: Decodable, Sendable, Equatable {
    public let newMessages: Int
    public let urgentMessages: Int
    public let emergencies: Int
    public let complications: Int
    public let criticalLabs: Int
}

public struct BriefingToday: Decodable, Sendable, Equatable {
    public let appointments: Int
    public let followUps: Int
}

public struct BriefingFacts: Decodable, Sendable, Equatable {
    public let generatedAt: Date
    public let yesterday: BriefingYesterday
    public let today: BriefingToday
    /// Emergencies first, then longest waiting.
    public let atRisk: [RiskItem]
}

public struct Briefing: Decodable, Sendable, Equatable {
    /// Always present. The briefing is data.
    public let facts: BriefingFacts
    /// A paragraph over the numbers, when the AI layer wrote one.
    public let narrative: String?
    public let quiet: Bool

    /**
     * Whether the screen has anything to show.
     *
     * Deliberately reads the facts rather than the narrative: a briefing with no
     * paragraph is still a briefing, and rendering the screen off the prose
     * would make a switched-off AI layer look like an empty morning.
     */
    public var hasContent: Bool { !quiet }
}

public struct BriefingAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Scoped to the caller's own patients, like every other clinical read.
    public func mine() async throws -> Briefing {
        try await client.send(Endpoint(method: .get, path: "me/briefing"), as: Briefing.self)
    }
}
