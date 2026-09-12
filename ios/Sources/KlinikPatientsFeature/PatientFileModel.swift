import Foundation
import KlinikAPI
import KlinikCore

/// A place inside the file. The feature names them; the app decides where they
/// lead, so this module carries no navigation.
public enum FileSection: String, Sendable, Equatable, CaseIterable {
    case messages
    case measurements
    case medications
    case documents
    case labReview
    case labTrend
    case photos
    case followUp
    case appointments
    case surveys
    case travel
    /// Documents the clinic needs before the operation (spec M17).
    case checklist
    /// What the patient has consented to, and the signature they drew (M17).
    case consents
    /**
     * What has been taken out of this file (spec M12).
     *
     * A section rather than a corner of the clinic-wide export screen: the
     * summary somebody asks for from a record used to land in a pile at the
     * bottom of another page, and finding it again meant reading the whole
     * clinic's history.
     */
    case exports
}

public enum PatientFilePhase: Sendable, Equatable {
    case loading
    case loaded(PatientFile)
    case notFound
    case failed(String)
}

public struct PatientFileState: Sendable, Equatable {
    public var phase: PatientFilePhase = .loading
    public var savingError: String?
    public var savedAt: Date?

    public init() {}

    public var file: PatientFile? {
        if case .loaded(let file) = phase { return file }
        return nil
    }
}

/**
 * One patient's file header (spec M2).
 *
 * Reads through `patients/:id/summary` rather than assembling the same picture
 * from nine endpoints: the counts on the section rows have to agree with each
 * other, and composed on the client from nine reads taken a second apart they
 * would not.
 *
 * Writes reload rather than patching the local copy. A `PUT` that answers 204
 * tells the client nothing about what the record now says — the version has
 * moved, the profile may have been created rather than updated — and guessing
 * is how a screen ends up showing an edit the server refused.
 */
@MainActor
public final class PatientFileModel {
    private let api: PatientsAPI
    /// Nil where the caller has no export rights to offer; the summary button
    /// is then absent rather than refused on press.
    private let exports: ExportsAPI?
    private let patientId: String

    private var state = PatientFileState()

    public init(api: PatientsAPI, exports: ExportsAPI? = nil, patientId: String) {
        self.api = api
        self.exports = exports
        self.patientId = patientId
    }

    public var canExportSummary: Bool { exports != nil }

    /**
     * Asks for the patient summary PDF (spec M12).
     *
     * Queued rather than returned: it carries measurement charts, lab tables
     * and — with consent — photographs, and building that while somebody waits
     * on a spinner is how a request times out on a slow connection. The export
     * screen is where it lands.
     */
    public func requestSummary(includePhotos: Bool) async -> Bool {
        guard let exports else { return false }

        state.savingError = nil

        do {
            _ = try await exports.requestSummary(
                patientId: patientId,
                includePhotos: includePhotos
            )

            return true
        } catch let error as APIError {
            state.savingError = L10n.message(for: error)
        } catch {
            state.savingError = L10n.string("error.server")
        }

        return false
    }

    public func currentState() -> PatientFileState { state }

    public func load() async {
        do {
            state.phase = .loaded(try await api.file(id: patientId))
        } catch APIError.notFound, APIError.forbidden {
            // The same message either way: saying "no access" would confirm
            // the file exists.
            state.phase = .notFound
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    public func save(_ edit: PatientEdit) async -> Bool {
        await write { try await self.api.update(id: self.patientId, edit) }
    }

    public func save(_ edit: MedicalProfileEdit) async -> Bool {
        await write { try await self.api.updateMedicalProfile(id: self.patientId, edit) }
    }

    private func write(_ work: () async throws -> Void) async -> Bool {
        state.savingError = nil

        do {
            try await work()
            await load()
            state.savedAt = Date()

            return true
        } catch APIError.conflict {
            // Somebody else changed the record between the read and the write.
            // Clinical data is never merged silently (spec M15).
            state.savingError = L10n.string("file.versionConflict")
        } catch let error as APIError {
            state.savingError = L10n.message(for: error)
        } catch {
            state.savingError = L10n.string("error.server")
        }

        return false
    }
}

public extension PatientFile {
    /// What each section row says under its name. Nil leaves the row plain
    /// rather than printing "0", which reads as a section that is broken.
    func badge(for section: FileSection) -> (text: String, urgent: Bool)? {
        switch section {
        case .messages:
            guard unreadMessages > 0 else { return nil }
            return ("\(unreadMessages)", true)

        case .labReview:
            guard alerts.labsAwaitingReview > 0 else { return nil }
            return ("\(alerts.labsAwaitingReview)", true)

        case .labTrend:
            guard alerts.criticalLabs > 0 else { return nil }
            return ("\(alerts.criticalLabs)", true)

        case .documents:
            guard alerts.processingDocuments > 0 else { return nil }
            return ("\(alerts.processingDocuments)", false)

        case .photos:
            guard counts.photos > 0 else { return nil }
            return ("\(counts.photos)", false)

        case .appointments:
            guard counts.appointments > 0 else { return nil }
            return ("\(counts.appointments)", false)

        case .medications:
            guard let adherence else { return nil }
            guard let percent = adherence.percent else {
                return ("\(adherence.activeMedications)", false)
            }
            return ("%\(percent)", adherence.needsAttention)

        case .measurements:
            guard let latest = latestMeasurements.first else { return nil }
            return (latest.reading, false)

        case .followUp:
            guard nextFollowUp != nil else { return nil }
            return (L10n.string("file.nextFollowUp"), false)

        case .surveys, .travel, .checklist, .consents, .exports:
            // The count would need a second read; the row is worth having
            // without one, and an empty badge is better than a wrong number.
            return nil
        }
    }
}
