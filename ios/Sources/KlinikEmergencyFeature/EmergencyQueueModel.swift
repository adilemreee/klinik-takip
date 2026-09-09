import Foundation
import KlinikAPI
import KlinikCore

public enum EmergencyQueuePhase: Sendable, Equatable {
    case loading
    case empty
    case loaded
    case failed(String)
}

public struct EmergencyQueueState: Sendable, Equatable {
    public var phase: EmergencyQueuePhase = .loading
    public var calls: [StaffEmergencyView] = []
    /// The row a write is running on, so only that row shows a spinner.
    public var busyId: String?
    public var actionError: String?

    public init() {}
}

/**
 * The calls nobody has answered yet (spec M8).
 *
 * Sorted by how long somebody has been waiting rather than by when the call
 * came in — an escalated call that has been ringing for twenty minutes belongs
 * above one raised thirty seconds ago, and those are not the same order once
 * the ladder has moved.
 */
@MainActor
public final class EmergencyQueueModel {
    private let api: EmergencyAPI
    private var state = EmergencyQueueState()

    public init(api: EmergencyAPI) {
        self.api = api
    }

    public func currentState() -> EmergencyQueueState { state }

    public func load() async {
        do {
            let calls = try await api.queue()
            state.calls = EmergencyQueueModel.ordered(calls)
            state.phase = calls.isEmpty ? .empty : .loaded
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    /// Taking the call. The row updates in place rather than the list reloading,
    /// so a colleague's call does not jump under the reader's thumb.
    public func acknowledge(_ id: String) async {
        await write(id) { try await self.api.acknowledge(id) }
    }

    /// Closing it. A resolution note is required by the server; the screen
    /// refuses to send an empty one rather than letting the server say no.
    public func resolve(_ id: String, note: String, falseAlarm: Bool) async {
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmed.isEmpty else {
            state.actionError = L10n.string("emergency.resolutionRequired")
            return
        }

        await write(id) {
            try await self.api.resolve(id, resolution: trimmed, falseAlarm: falseAlarm)
        }

        // A closed call leaves the queue: the list is what is still open.
        state.calls.removeAll { $0.id == id }
        state.phase = state.calls.isEmpty ? .empty : .loaded
    }

    private func write(_ id: String, _ work: () async throws -> StaffEmergencyView) async {
        state.busyId = id
        state.actionError = nil

        defer { state.busyId = nil }

        do {
            let updated = try await work()

            if let index = state.calls.firstIndex(where: { $0.id == id }) {
                state.calls[index] = updated
            }
        } catch let error as APIError {
            state.actionError = L10n.message(for: error)
        } catch {
            state.actionError = L10n.string("error.server")
        }
    }

    static func ordered(_ calls: [StaffEmergencyView]) -> [StaffEmergencyView] {
        calls.sorted { left, right in
            if left.unanswered != right.unanswered { return left.unanswered }
            if left.event.escalationLevel != right.event.escalationLevel {
                return left.event.escalationLevel > right.event.escalationLevel
            }

            return left.waitingMinutes > right.waitingMinutes
        }
    }
}
