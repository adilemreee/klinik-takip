import Foundation
import KlinikAPI
import KlinikCore

public enum FollowUpPhase: Sendable, Equatable {
    case loading
    case loaded
    /// No schedule yet — usually because the operation has not been recorded.
    case none
    case notFound
    case failed(String)
}

public struct FollowUpState: Sendable, Equatable {
    public var phase: FollowUpPhase = .loading
    public var schedule: FollowUpSchedule?
    /// The milestone being marked, so its buttons can be disabled.
    public var working: String?
    public var error: String?

    public var next: Milestone? { schedule?.next() }
    public var missed: [Milestone] { schedule?.missed ?? [] }

    public init() {}
}

/// The check-up calendar (spec M6).
public actor FollowUpModel {
    private let api: FollowUpAPI
    private let load: @Sendable (FollowUpAPI) async throws -> FollowUpSchedule?

    private(set) public var state = FollowUpState()

    /// The patient's own schedule.
    public init(api: FollowUpAPI) {
        self.api = api
        self.load = { try await $0.mine() }
    }

    /// A named patient's schedule, for staff.
    public init(api: FollowUpAPI, patientId: String) {
        self.api = api
        self.load = { try await $0.forPatient(patientId) }
    }

    public func currentState() -> FollowUpState { state }

    public func refresh() async {
        state.phase = .loading

        do {
            let schedule = try await load(api)
            state.schedule = schedule
            state.phase = schedule == nil ? .none : .loaded
        } catch let error as APIError {
            if case .notFound = error {
                state.phase = .notFound
            } else {
                state.phase = .failed(L10n.message(for: error))
            }
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    /**
     * Marks a visit attended or skipped.
     *
     * The row is replaced with what the server returned rather than flipped
     * locally: a check-up that shows as attended when the clinic's record says
     * otherwise is the kind of disagreement nobody notices until someone is not
     * called.
     */
    @discardableResult
    public func mark(_ milestoneId: String, as status: MilestoneStatus) async -> Bool {
        guard state.working == nil, var schedule = state.schedule else { return false }

        state.working = milestoneId
        state.error = nil
        defer { state.working = nil }

        do {
            let updated = try await api.setStatus(milestoneId: milestoneId, status: status)

            schedule = FollowUpSchedule(
                id: schedule.id,
                patientId: schedule.patientId,
                surgeryDate: schedule.surgeryDate,
                template: schedule.template,
                milestones: schedule.milestones.map { $0.id == updated.id ? updated : $0 }
            )
            state.schedule = schedule
        } catch let error as APIError {
            state.error = L10n.message(for: error)
            return false
        } catch {
            state.error = L10n.string("error.server")
            return false
        }

        return true
    }
}
