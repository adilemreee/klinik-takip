import Foundation
import KlinikAPI
import KlinikCore

public enum MedicationsPhase: Sendable, Equatable {
    case loading
    case loaded
    /// Nothing prescribed and nothing reported. Not a failure.
    case empty
    case notFound
    case failed(String)
}

public struct MedicationsState: Sendable, Equatable {
    public var phase: MedicationsPhase = .loading
    public var medications: [MedicationView] = []
    public var today: [DoseLog] = []
    public var overall: Adherence?
    public var badges: [String] = []
    /// The dose being checked in, so its buttons can be disabled.
    public var working: String?
    public var error: String?

    /**
     * Check-ins that are on the phone and not yet at the clinic.
     *
     * Keyed by dose. The screen shows what the patient chose, marked as
     * unsent — which is the honest middle between snapping the row back to
     * "not taken", which reads as the app having ignored the tap, and showing
     * a plain tick, which claims the clinic knows.
     */
    public var unsent: [String: MedicationsAPI.CheckInAction] = [:]

    public var openToday: [DoseLog] { today.filter(\.status.isOpen) }

    public func medication(for dose: DoseLog) -> Medication? {
        medications.first { $0.medication.id == dose.medicationId }?.medication
    }

    public init() {}
}

/**
 * The patient's medications and today's check-in (spec M9).
 *
 * Two rules the screen depends on and neither of which is cosmetic:
 *
 *   1. **A dose is never silently flipped locally.** The row is replaced with
 *      whatever the server returned. A dose showing as taken when the clinic's
 *      record says otherwise is a disagreement nobody notices until somebody
 *      is treated on the wrong assumption. The one exception is a check-in the
 *      app is holding because there was no connection (spec M15) — and that is
 *      not an exception to the rule so much as the reason for it: the row
 *      shows what the patient chose *and* says it has not been sent, which is
 *      the only description of the situation that is true.
 *   2. **An absent adherence score is not nought.** A course with nothing due
 *      yet has no score, and rendering that as 0% tells a patient on their
 *      first morning that they are already failing.
 */
public actor MedicationsModel {
    private let api: MedicationsAPI
    /// The offline queue, read-only. Nil in tests that have nothing to say
    /// about it.
    private let queue: PendingWriteReader?

    private(set) public var state = MedicationsState()

    public init(api: MedicationsAPI, queue: PendingWriteReader? = nil) {
        self.api = api
        self.queue = queue
    }

    public func currentState() -> MedicationsState { state }

    public func refresh() async {
        state.phase = .loading
        state.error = nil

        // Read first, so a reload that fails still leaves the patient's own
        // unsent check-ins on screen.
        await readQueue()

        do {
            let mine = try await api.mine()
            state.medications = mine.medications
            state.today = mine.today
            state.overall = mine.overall
            state.badges = mine.badges
            state.phase = mine.medications.isEmpty && mine.today.isEmpty ? .empty : .loaded
        } catch let error as APIError {
            if case .notFound = error {
                // The account has no patient file linked yet. Not an error to
                // retry — there is nothing to fetch until the clinic links it.
                state.phase = .notFound
            } else {
                state.phase = .failed(L10n.message(for: error))
            }
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    /// What the queue is still holding for these doses.
    private func readQueue() async {
        guard let queue else { return }

        let writes = await queue.unsent(entityType: MedicationsAPI.queuedDoseEntity)
        var unsent: [String: MedicationsAPI.CheckInAction] = [:]

        for write in writes {
            // Last one wins: two check-ins on the same dose are sent in order,
            // and what the patient chose most recently is what they meant.
            if let action = MedicationsAPI.queuedAction(in: write) {
                unsent[write.entityId] = action
            }
        }

        state.unsent = unsent
    }

    /**
     * Records what the patient did about one dose.
     *
     * Returns whether it reached the clinic. A false here must not be shown as
     * a tick: the whole value of the check-in is that the record matches what
     * actually happened.
     */
    @discardableResult
    public func checkIn(
        _ logId: String,
        action: MedicationsAPI.CheckInAction,
        snoozeMinutes: Int? = nil
    ) async -> Bool {
        guard state.working == nil else { return false }

        state.working = logId
        state.error = nil
        defer { state.working = nil }

        do {
            let updated = try await api.checkIn(logId, action: action, snoozeMinutes: snoozeMinutes)
            state.today = state.today.map { $0.id == updated.id ? updated : $0 }
            state.unsent[logId] = nil
        } catch APIError.queuedForLater {
            // Kept, not lost. The row says what the patient chose and that the
            // clinic has not seen it yet.
            state.unsent[logId] = action
            state.error = nil
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
