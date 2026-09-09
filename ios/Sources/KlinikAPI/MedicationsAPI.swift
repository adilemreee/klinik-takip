import Foundation
import KlinikCore

public enum MedicationSource: String, Decodable, Sendable, Equatable {
    case prescribed = "PRESCRIBED"
    /// Added by the patient. Inert until a clinician approves it.
    case patientReported = "PATIENT_REPORTED"
}

public enum DoseStatus: String, Decodable, Sendable, Equatable {
    case pending = "PENDING"
    case taken = "TAKEN"
    case skipped = "SKIPPED"
    /// Taken, but well after its time. Still counts.
    case late = "LATE"
    case snoozed = "SNOOZED"

    public var localizedName: String { L10n.string("medication.status.\(rawValue)") }

    /// Whether the patient still has something to do about this dose.
    public var isOpen: Bool { self == .pending || self == .snoozed }
}

public struct Medication: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let patientId: String
    public let drugName: String
    public let dose: String
    public let form: String?
    public let frequencyRule: String
    /// The wall clock the doses belong to — the patient's, not the clinic's.
    public let timezone: String
    public let startDate: Date
    public let endDate: Date?
    public let instructions: String?
    public let source: MedicationSource
    /// Null while a patient-reported medication is waiting for a clinician.
    public let approvedAt: Date?
    public let stoppedAt: Date?

    public var isActive: Bool { stoppedAt == nil && approvedAt != nil }
    public var awaitingApproval: Bool { approvedAt == nil && stoppedAt == nil }
}

public struct Adherence: Decodable, Sendable, Equatable {
    /// 0–1 over the doses that have come due. Null before any have.
    public let score: Double?
    public let taken: Int
    public let missed: Int
    public let due: Int
    public let upcoming: Int
    public let streak: Int

    /// A whole-number percentage, or nil when there is nothing to report yet.
    public var percentage: Int? {
        score.map { Int(($0 * 100).rounded()) }
    }

    /**
     * Whether to show the score at all.
     *
     * A course with nothing due yet has no score, and rendering that as nought
     * per cent would tell a patient on their first morning that they are
     * failing.
     */
    public var hasScore: Bool { score != nil }
}

public struct DoseLog: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let medicationId: String
    public let scheduledAt: Date
    public let takenAt: Date?
    public let status: DoseStatus
    public let snoozedUntil: Date?
}

public enum InteractionSeverity: String, Decodable, Sendable, Equatable, CaseIterable {
    case contraindicated = "CONTRAINDICATED"
    case major = "MAJOR"
    case moderate = "MODERATE"
    case minor = "MINOR"

    public var localizedName: String { L10n.string("interaction.severity.\(rawValue)") }

    /**
     * Whether this one has to interrupt.
     *
     * Everything is shown; interrupting on a minor interaction is how a clinic
     * learns to dismiss the dialog without reading it.
     */
    public var isSevere: Bool { self == .contraindicated || self == .major }
}

public struct InteractingDrug: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    /// As it was written.
    public let drugName: String
}

public struct InteractionWarning: Decodable, Sendable, Equatable {
    public let severity: InteractionSeverity
    public let note: String
    public let ingredients: [String]
    /// The two medications, in the clinician's own words.
    public let between: [InteractingDrug]
}

public struct InteractionCheck: Decodable, Sendable, Equatable {
    /// Most serious first.
    public let warnings: [InteractionWarning]
    /**
     * Drugs the reference did not recognise.
     *
     * The screen must show this. An empty warning list next to three
     * unrecognised drugs is not a clean bill of health, and reading it as one
     * is how software misleads somebody.
     */
    public let unrecognised: [InteractingDrug]
    /// Zero means nothing was actually compared.
    public let comparedPairs: Int

    /// Whether the answer says anything at all about safety.
    public var checkedAnything: Bool { comparedPairs > 0 }
    public var hasSevere: Bool { warnings.contains(where: \.severity.isSevere) }
}

public struct MedicationView: Decodable, Sendable, Equatable, Identifiable {
    public let medication: Medication
    /// The rule in a sentence, so a clinician can check what they wrote.
    public let schedule: String
    public let adherence: Adherence
    public let badges: [String]
    public let nextDose: Date?
    /// Present when a clinician has just written or approved a prescription.
    public let interactions: InteractionCheck?

    public var id: String { medication.id }
}

public struct MyMedications: Decodable, Sendable, Equatable {
    public let medications: [MedicationView]
    /// Today's doses, in order, for the check-in screen.
    public let today: [DoseLog]
    public let overall: Adherence
    /// Withheld while a course is going badly — the tone rule from M9.
    public let badges: [String]

    public var localizedBadges: [String] {
        badges.map { L10n.string("medication.badge.\($0)") }
    }

    /// Doses still waiting on the patient right now.
    public var openToday: [DoseLog] { today.filter(\.status.isOpen) }
}

/**
 * A plan, as the server wants it.
 *
 * `frequencyRule` is an RRULE, which is the right thing to store and the wrong
 * thing to ask a doctor to type. `Schedule` builds it from the two questions a
 * clinician actually answers — how many times a day, and for how long.
 */
public struct Prescription: Encodable, Sendable, Equatable {
    public let drugName: String
    public let dose: String
    public let form: String?
    public let frequencyRule: String
    public let startDate: Date
    public let startTime: String?
    public let timezone: String?
    public let instructions: String?

    public init(
        drugName: String,
        dose: String,
        form: String? = nil,
        frequencyRule: String,
        startDate: Date,
        startTime: String? = nil,
        timezone: String? = nil,
        instructions: String? = nil
    ) {
        self.drugName = drugName
        self.dose = dose
        self.form = form
        self.frequencyRule = frequencyRule
        self.startDate = startDate
        self.startTime = startTime
        self.timezone = timezone
        self.instructions = instructions
    }
}

public struct MedicationsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func mine() async throws -> MyMedications {
        try await client.send(Endpoint(method: .get, path: "me/medications"), as: MyMedications.self)
    }

    public func forPatient(_ patientId: String) async throws -> [MedicationView] {
        try await client.send(
            Endpoint(method: .get, path: "patients/\(patientId)/medications"),
            as: [MedicationView].self
        )
    }

    /// What the reference knows about the drugs this patient is on.
    public func interactions(patientId: String) async throws -> InteractionCheck {
        try await client.send(
            Endpoint(method: .get, path: "patients/\(patientId)/medications/interactions"),
            as: InteractionCheck.self
        )
    }

    /// "İçtim" / "Atladım" / "Ertele".
    public func checkIn(
        _ logId: String,
        action: CheckInAction,
        snoozeMinutes: Int? = nil
    ) async throws -> DoseLog {
        try await client.send(
            Endpoint(
                method: .patch,
                path: "me/medications/doses/\(logId)",
                body: try JSONEncoder.klinik.encode(
                    CheckInBody(action: action.rawValue, snoozeMinutes: snoozeMinutes)
                )
            ),
            as: DoseLog.self
        )
    }

    /// Something the patient is already taking; a clinician approves it.
    public func report(
        drugName: String,
        dose: String,
        frequencyRule: String,
        startDate: Date
    ) async throws -> MedicationView {
        try await client.send(
            Endpoint(
                method: .post,
                path: "me/medications",
                body: try JSONEncoder.klinik.encode(
                    ReportBody(
                        drugName: drugName,
                        dose: dose,
                        frequencyRule: frequencyRule,
                        startDate: startDate
                    )
                )
            ),
            as: MedicationView.self
        )
    }

    // MARK: - Staff (spec M9)

    /// Writing a plan. The interaction check comes back on the response rather
    /// than on every list read: the moment it matters is the moment a drug is
    /// added, and a warning shown on every read stops being read.
    public func prescribe(patientId: String, _ prescription: Prescription) async throws -> MedicationView {
        try await client.send(
            Endpoint(
                method: .post,
                path: "patients/\(patientId)/medications",
                body: try JSONEncoder.klinik.encode(prescription)
            ),
            as: MedicationView.self
        )
    }

    /// Something the patient added is inert until this is called (spec M9).
    public func approve(patientId: String, medicationId: String) async throws -> MedicationView {
        try await client.send(
            Endpoint(
                method: .patch,
                path: "patients/\(patientId)/medications/\(medicationId)/approve"
            ),
            as: MedicationView.self
        )
    }

    public func stop(patientId: String, medicationId: String) async throws -> MedicationView {
        try await client.send(
            Endpoint(
                method: .patch,
                path: "patients/\(patientId)/medications/\(medicationId)/stop"
            ),
            as: MedicationView.self
        )
    }

    public enum CheckInAction: String, Sendable {
        case taken
        case skipped
        case snooze
    }

    private struct CheckInBody: Encodable {
        let action: String
        let snoozeMinutes: Int?
    }

    private struct ReportBody: Encodable {
        let drugName: String
        let dose: String
        let frequencyRule: String
        let startDate: Date
    }
}
