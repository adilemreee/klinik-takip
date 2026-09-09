import Foundation
import KlinikAPI
import KlinikCore

public enum PrescribingPhase: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

public struct PrescribingState: Sendable, Equatable {
    public var phase: PrescribingPhase = .loading
    public var medications: [MedicationView] = []
    /// What the reference knows about this patient's drugs together.
    public var interactions: InteractionCheck?
    public var busyId: String?
    public var error: String?
    /// Set after a write, so the sheet knows to close.
    public var lastWritten: MedicationView?

    public init() {}

    public var active: [MedicationView] {
        medications.filter { $0.medication.isActive }
    }

    public var awaitingApproval: [MedicationView] {
        medications.filter(\.medication.awaitingApproval)
    }

    public var stopped: [MedicationView] {
        medications.filter { $0.medication.stoppedAt != nil }
    }
}

/**
 * The clinician's side of the medication module (spec M9).
 *
 * Until this existed the doctor could read a plan and not write one, which is
 * the wrong way round: the spec has the clinician define the plan and the
 * patient tick the doses off.
 *
 * The interaction check is loaded beside the list rather than only after a
 * write, because a doctor opening this screen is often opening it *to* decide
 * whether to add something — and the reference is explicit that a missing
 * warning is not a safety claim.
 */
@MainActor
public final class PrescribingModel {
    private let api: MedicationsAPI
    private let patientId: String

    private var state = PrescribingState()

    public init(api: MedicationsAPI, patientId: String) {
        self.api = api
        self.patientId = patientId
    }

    public func currentState() -> PrescribingState { state }

    public func load() async {
        do {
            async let medications = api.forPatient(patientId)
            // Best-effort: the reference table being unavailable must not stop
            // a doctor reading the plan.
            async let interactions = try? await api.interactions(patientId: patientId)

            state.medications = try await medications
            state.interactions = await interactions
            state.phase = state.medications.isEmpty ? .empty : .loaded
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    public func prescribe(_ prescription: Prescription) async -> Bool {
        state.error = nil
        state.busyId = "new"

        defer { state.busyId = nil }

        do {
            let written = try await api.prescribe(patientId: patientId, prescription)
            state.lastWritten = written
            await load()

            return true
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }

        return false
    }

    public func approve(_ medicationId: String) async {
        await write(medicationId) {
            try await self.api.approve(patientId: self.patientId, medicationId: medicationId)
        }
    }

    public func stop(_ medicationId: String) async {
        await write(medicationId) {
            try await self.api.stop(patientId: self.patientId, medicationId: medicationId)
        }
    }

    private func write(_ id: String, _ work: () async throws -> MedicationView) async {
        state.busyId = id
        state.error = nil

        defer { state.busyId = nil }

        do {
            let updated = try await work()

            // Replaced with what the server returned rather than flipped
            // locally: an approval the server refused must not look applied.
            if let index = state.medications.firstIndex(where: { $0.id == id }) {
                state.medications[index] = updated
            }

            // A stop or an approval changes what the interaction check compares.
            state.interactions = try? await api.interactions(patientId: patientId)
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }
    }
}
