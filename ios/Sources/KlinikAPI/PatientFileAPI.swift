import Foundation
import KlinikCore

// MARK: - The file header (spec M2)

public struct PatientIdentity: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let mrn: String
    public let firstName: String
    public let lastName: String
    public let birthDate: Date
    /// Computed by the server, so the card, the emergency snapshot and the
    /// discharge advice cannot disagree about how old somebody is.
    public let age: Int
    public let sex: String
    public let country: String
    public let city: String?
    public let nationality: String?
    public let preferredLanguage: String
    public let referralSource: String?
    public let status: String
    public let createdAt: Date
    /// Sent back when editing, so a concurrent change is refused rather than
    /// silently overwritten (spec M15).
    public let version: Int

    public var fullName: String { "\(firstName) \(lastName)" }

    public var localizedSex: String { L10n.string("patient.sex.\(sex)") }
    public var localizedStatus: String { L10n.string("patient.status.\(status)") }
}

public struct PatientContact: Decodable, Sendable, Equatable {
    public let email: String?
    public let phone: String?
}

public struct MedicalProfile: Decodable, Sendable, Equatable {
    public let bloodType: String?
    public let allergies: [String]
    public let chronicConditions: [String]
    /// What the patient says they take — not the prescribed plan.
    public let currentMedications: [String]
    public let smoking: Bool?
    public let alcohol: Bool?
    public let targetWeightKg: String?
    public let notes: String?
    public let updatedAt: Date
    public let version: Int

    /// Whether the profile has anything in it. A row of dashes reads as a
    /// system that lost the data; an empty state says nobody has filled it in.
    public var isEmpty: Bool {
        bloodType == nil && allergies.isEmpty && chronicConditions.isEmpty
            && currentMedications.isEmpty && smoking == nil && alcohol == nil
            && targetWeightKg == nil && (notes?.isEmpty ?? true)
    }
}

public struct SurgerySummary: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let procedureName: String
    public let performedAt: Date
    public let daysAgo: Int
    public let location: String?
    public let surgeonName: String?
}

public struct AssignedStaff: Decodable, Sendable, Equatable, Identifiable {
    public let staffId: String
    public let name: String
    public let title: String?
    public let role: String

    public var id: String { staffId }
    public var localizedRole: String { L10n.string("role.\(role)") }
}

public struct LatestMeasurement: Decodable, Sendable, Equatable, Identifiable {
    public let type: MeasurementType
    public let value: String
    public let secondaryValue: String?
    public let unit: String
    public let measuredAt: Date
    public let source: MeasurementSource

    public var id: String { type.rawValue }

    /// "120/80 mmHg" for blood pressure, "72.4 kg" for everything else.
    public var reading: String {
        if let secondaryValue { return "\(value)/\(secondaryValue) \(unit)" }

        return "\(value) \(unit)"
    }
}

public struct FileAlerts: Decodable, Sendable, Equatable {
    public let criticalLabs: Int
    public let labsAwaitingReview: Int
    public let openComplications: Int
    public let openEmergency: Bool
    public let processingDocuments: Int
    public let unreviewedReports: Int

    /// Whether anything on this file needs a person today.
    public var any: Bool {
        criticalLabs > 0 || openComplications > 0 || openEmergency
            || labsAwaitingReview > 0 || unreviewedReports > 0
    }
}

public struct LastMessage: Decodable, Sendable, Equatable {
    public let body: String?
    public let sentAt: Date
    public let fromPatient: Bool
}

public struct NextAppointmentSummary: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let scheduledAt: Date
    public let type: String
    public let status: String
}

public struct NextFollowUp: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let dueAt: Date
    public let status: String
}

public struct AdherenceSummary: Decodable, Sendable, Equatable {
    /// 0–1 over the doses that have come due, or nil when none have.
    public let score: Double?
    public let taken: Int
    public let missed: Int
    public let due: Int
    public let upcoming: Int
    public let streak: Int
    public let activeMedications: Int

    /// The threshold the spec sets for an automatic warning (M9).
    public var needsAttention: Bool { (score ?? 1) < 0.7 && due >= 6 }

    public var percent: Int? { score.map { Int(($0 * 100).rounded()) } }
}

public struct FileCounts: Decodable, Sendable, Equatable {
    public let documents: Int
    public let photos: Int
    public let labResults: Int
    public let appointments: Int
}

/// Everything the file header shows, in one read.
public struct PatientFile: Decodable, Sendable, Equatable {
    public let patient: PatientIdentity
    public let contact: PatientContact
    public let medicalProfile: MedicalProfile?
    public let lastSurgery: SurgerySummary?
    public let assignments: [AssignedStaff]
    public let latestMeasurements: [LatestMeasurement]
    public let alerts: FileAlerts
    public let lastMessage: LastMessage?
    public let unreadMessages: Int
    public let nextAppointment: NextAppointmentSummary?
    public let nextFollowUp: NextFollowUp?
    /// Nil when nothing has been prescribed — not the same as zero adherence.
    public let adherence: AdherenceSummary?
    public let counts: FileCounts
}

// MARK: - Editing

/// A change to the file. Only what somebody typed is sent, so a field left
/// alone is not overwritten by a stale copy of itself.
public struct PatientEdit: Encodable, Sendable, Equatable {
    public var firstName: String?
    public var lastName: String?
    public var birthDate: Date?
    public var sex: String?
    public var country: String?
    public var city: String?
    public var preferredLanguage: String?
    public var status: String?
    public var expectedVersion: Int?

    public init(
        firstName: String? = nil,
        lastName: String? = nil,
        birthDate: Date? = nil,
        sex: String? = nil,
        country: String? = nil,
        city: String? = nil,
        preferredLanguage: String? = nil,
        status: String? = nil,
        expectedVersion: Int? = nil
    ) {
        self.firstName = firstName
        self.lastName = lastName
        self.birthDate = birthDate
        self.sex = sex
        self.country = country
        self.city = city
        self.preferredLanguage = preferredLanguage
        self.status = status
        self.expectedVersion = expectedVersion
    }
}

public struct MedicalProfileEdit: Encodable, Sendable, Equatable {
    public var bloodType: String?
    public var allergies: [String]?
    public var chronicConditions: [String]?
    public var currentMedications: [String]?
    public var smoking: Bool?
    public var alcohol: Bool?
    public var targetWeightKg: Double?
    public var notes: String?
    public var expectedVersion: Int?

    public init(
        bloodType: String? = nil,
        allergies: [String]? = nil,
        chronicConditions: [String]? = nil,
        currentMedications: [String]? = nil,
        smoking: Bool? = nil,
        alcohol: Bool? = nil,
        targetWeightKg: Double? = nil,
        notes: String? = nil,
        expectedVersion: Int? = nil
    ) {
        self.bloodType = bloodType
        self.allergies = allergies
        self.chronicConditions = chronicConditions
        self.currentMedications = currentMedications
        self.smoking = smoking
        self.alcohol = alcohol
        self.targetWeightKg = targetWeightKg
        self.notes = notes
        self.expectedVersion = expectedVersion
    }
}

public extension PatientsAPI {
    /// The whole header. One call, so the counts on the file's sections agree
    /// with each other.
    func file(id: String) async throws -> PatientFile {
        try await client.send(
            Endpoint(method: .get, path: "patients/\(id)/summary"),
            as: PatientFile.self
        )
    }

    func update(id: String, _ edit: PatientEdit) async throws -> Patient {
        try await client.send(
            Endpoint(
                method: .patch,
                path: "patients/\(id)",
                body: try JSONEncoder.klinik.encode(edit)
            ),
            as: Patient.self
        )
    }

    /// Returns nothing: the server answers 204, and the screen reloads the
    /// header rather than trusting a local copy of what it just sent.
    func updateMedicalProfile(id: String, _ edit: MedicalProfileEdit) async throws {
        try await client.send(
            Endpoint(
                method: .put,
                path: "patients/\(id)/medical-profile",
                body: try JSONEncoder.klinik.encode(edit)
            )
        )
    }

    func assignments(id: String) async throws -> [AssignedStaff] {
        try await client.send(
            Endpoint(method: .get, path: "patients/\(id)/assignments"),
            as: [AssignedStaff].self
        )
    }
}
