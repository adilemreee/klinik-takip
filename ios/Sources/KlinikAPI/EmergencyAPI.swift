import Foundation
import KlinikCore

public enum EmergencyStatus: String, Decodable, Sendable, Equatable {
    case triggered = "TRIGGERED"
    case acknowledged = "ACKNOWLEDGED"
    case resolved = "RESOLVED"
    case falseAlarm = "FALSE_ALARM"

    /// Whether the clinic is still working on it.
    public var isOpen: Bool { self == .triggered || self == .acknowledged }
}

public struct EmergencyEvent: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let patientId: String
    public let status: EmergencyStatus
    public let triggeredAt: Date
    public let latitude: String?
    public let longitude: String?
    public let note: String?
    /// 0 immediately, 1 at two minutes, 2 at five.
    public let escalationLevel: Int
    public let acknowledgedAt: Date?
    public let resolution: String?
    public let resolvedAt: Date?
}

public struct EmergencyNumber: Decodable, Sendable, Equatable {
    public let number: String
    public let countryCode: String
    /// `country` when the server knew it, `international` when it guessed.
    public let source: String

    /// A guessed number needs the caveat next to it; a known one does not.
    public var isGuess: Bool { source != "country" }

    /// What `tel:` accepts — a short code with no punctuation to strip.
    public var dialURL: URL? { URL(string: "tel://\(number)") }
}

public struct GuidanceStep: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let text: String
    /// The one line that points away from the clinic, rendered larger.
    public let critical: Bool
}

public struct EmergencyGuidance: Decodable, Sendable, Equatable {
    public let language: String
    public let emergencyNumber: EmergencyNumber
    public let steps: [GuidanceStep]

    public var criticalStep: GuidanceStep? { steps.first { $0.critical } }
    public var ordinarySteps: [GuidanceStep] { steps.filter { !$0.critical } }
}

public struct PatientEmergencyView: Decodable, Sendable, Equatable {
    public let event: EmergencyEvent
    public let guidance: EmergencyGuidance
    /// The button was pressed on a call that was already open.
    public let alreadyOpen: Bool
}

public struct EmergencySummary: Decodable, Sendable, Equatable {
    public let patientId: String
    public let mrn: String
    public let fullName: String
    public let age: Int?
    public let sex: String
    public let country: String
    public let city: String?
    public let phone: String?
    public let preferredLanguage: String
    public let bloodType: String?
    public let allergies: [String]
    public let chronicConditions: [String]
    public let currentMedications: [String]
    public let lastSurgery: LastSurgery?
    public let assignedDoctor: String?

    public struct LastSurgery: Decodable, Sendable, Equatable {
        public let procedureName: String
        public let performedAt: Date
        public let daysAgo: Int
    }
}

public struct StaffEmergencyView: Decodable, Sendable, Equatable, Identifiable {
    public let event: EmergencyEvent
    public let summary: EmergencySummary
    public let waitingMinutes: Int
    public let responseMinutes: Int?
    /// The escalation ladder ran out and nobody has answered.
    public let unanswered: Bool

    public var id: String { event.id }
}

public struct EmergencyAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /**
     * The button.
     *
     * Location is passed when the device has one and omitted when it does not.
     * It is never waited for: a fix can take fifteen seconds on a cold start,
     * and the alarm is worth more than the pin.
     */
    public func trigger(
        latitude: Double? = nil,
        longitude: Double? = nil,
        note: String? = nil
    ) async throws -> PatientEmergencyView {
        try await client.send(
            Endpoint(
                method: .post,
                path: "me/emergency",
                body: try JSONEncoder.klinik.encode(
                    TriggerBody(latitude: latitude, longitude: longitude, note: note)
                )
            ),
            as: PatientEmergencyView.self
        )
    }

    /// Fetched ahead of time so the card is already on the device when it is needed.
    public func guidance() async throws -> EmergencyGuidance {
        try await client.send(
            Endpoint(method: .get, path: "me/emergency/guidance"),
            as: EmergencyGuidance.self
        )
    }

    public func active() async throws -> PatientEmergencyView? {
        try await client.send(
            Endpoint(method: .get, path: "me/emergency/active"),
            as: PatientEmergencyView?.self
        )
    }

    public func cancel(_ emergencyId: String) async throws -> EmergencyEvent {
        try await client.send(
            Endpoint(method: .patch, path: "me/emergency/\(emergencyId)/cancel"),
            as: EmergencyEvent.self
        )
    }

    public func queue(includeClosed: Bool = false) async throws -> [StaffEmergencyView] {
        try await client.send(
            Endpoint(
                method: .get,
                path: "emergency",
                query: includeClosed ? ["includeClosed": "true"] : [:]
            ),
            as: [StaffEmergencyView].self
        )
    }

    public func detail(_ emergencyId: String) async throws -> StaffEmergencyView {
        try await client.send(
            Endpoint(method: .get, path: "emergency/\(emergencyId)"),
            as: StaffEmergencyView.self
        )
    }

    public func acknowledge(_ emergencyId: String) async throws -> StaffEmergencyView {
        try await client.send(
            Endpoint(method: .patch, path: "emergency/\(emergencyId)/acknowledge"),
            as: StaffEmergencyView.self
        )
    }

    public func resolve(
        _ emergencyId: String,
        resolution: String,
        falseAlarm: Bool = false
    ) async throws -> StaffEmergencyView {
        try await client.send(
            Endpoint(
                method: .patch,
                path: "emergency/\(emergencyId)/resolve",
                body: try JSONEncoder.klinik.encode(
                    ResolveBody(resolution: resolution, falseAlarm: falseAlarm)
                )
            ),
            as: StaffEmergencyView.self
        )
    }

    private struct TriggerBody: Encodable {
        let latitude: Double?
        let longitude: Double?
        let note: String?
    }

    private struct ResolveBody: Encodable {
        let resolution: String
        let falseAlarm: Bool
    }
}
