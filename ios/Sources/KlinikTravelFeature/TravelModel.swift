import Foundation
import KlinikAPI
import KlinikCore

public enum TravelPhase: Sendable, Equatable {
    case loading
    case loaded
    case notFound
    case failed(String)
}

public struct TravelState: Sendable, Equatable {
    public var phase: TravelPhase = .loading
    public var plan: TravelPlan?
    public var clearedToFlyBy: String?
    public var saving = false
    public var error: String?

    public init() {}
}

/**
 * A patient's trip (spec M19).
 *
 * Two callers with different rights. A coordinator fills the whole thing in
 * with `patients.write` and never sees a lab result; a doctor additionally says
 * whether the patient may fly, which needs `medical.decide`. The model does not
 * enforce either — the server does — but it does render the difference, so
 * nobody is shown a switch they will be refused.
 */
@MainActor
public final class TravelModel {
    private let api: TravelAPI
    /// Nil on the patient's own copy, which reads `me/travel` and edits nothing.
    private let patientId: String?

    private var state = TravelState()

    public init(api: TravelAPI, patientId: String? = nil) {
        self.api = api
        self.patientId = patientId
    }

    public func currentState() -> TravelState { state }

    public func load() async {
        do {
            let view = patientId.map { id in { try await self.api.forPatient(id) } }
                ?? { try await self.api.mine() }

            let loaded = try await view()
            state.plan = loaded.plan
            state.clearedToFlyBy = loaded.clearedToFlyBy
            state.phase = .loaded
        } catch APIError.notFound {
            state.phase = .notFound
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    public func save(_ edit: TravelPlanEdit) async -> Bool {
        guard let patientId else { return false }

        state.saving = true
        state.error = nil

        defer { state.saving = false }

        do {
            var payload = edit
            payload.expectedVersion = state.plan?.version

            state.plan = try await api.save(patientId: patientId, payload)

            return true
        } catch APIError.conflict {
            state.error = L10n.string("file.versionConflict")
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }

        return false
    }

    /// A clinician's decision, not a calculation.
    public func setClearedToFly(_ cleared: Bool) async {
        guard let patientId else { return }

        state.saving = true
        state.error = nil

        defer { state.saving = false }

        do {
            state.plan = try await api.setClearedToFly(patientId: patientId, cleared: cleared)
            // Re-read for the name of whoever just signed it off; the write
            // returns the plan and not the person.
            await load()
        } catch APIError.forbidden {
            // A coordinator pressing this is not an error worth a red banner —
            // they simply may not, and the screen should say which.
            state.error = L10n.string("travel.clearanceForbidden")
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }
    }
}
