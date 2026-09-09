import Foundation
import KlinikAPI
import KlinikCore

/// What happened when one queued change was sent.
public enum SendOutcome: Sendable, Equatable {
    case applied
    /// The server refused it because the record moved on. Carries what the
    /// server has now, so the user can be shown both sides.
    case conflict(serverRecord: Data, serverVersion: Int)
    /// Worth trying again later — no connection, or the server is struggling.
    case retryable(String)
    /// Will never succeed as written: a validation failure, or a permission
    /// the user no longer has.
    case rejected(String)
}

/// Sends one queued change. A port, so the engine is testable without a server.
public protocol OutboxSender: Sendable {
    func send(_ entry: OutboxEntry) async -> SendOutcome
}

/// What the sync indicator shows (spec M15).
public enum SyncStatus: Sendable, Equatable {
    case upToDate
    case offline(pending: Int)
    case syncing(remaining: Int)
    /// Something needs a person: a conflict to resolve, or a change the server
    /// will not accept.
    case needsAttention(conflicts: Int, rejected: Int)
}

public struct SyncState: Sendable, Equatable {
    public var status: SyncStatus = .upToDate
    public var lastSyncedAt: Date?

    public init() {}
}

/**
 Drains the outbox.

 Two rules shape the whole thing, and both come from spec M15's insistence that
 clinical data is never silently overwritten:

 - A refused change is kept, not discarded. The user's work is not thrown away
   because someone else saved first.
 - When one change to a record conflicts, the later changes to *that record*
   are held back. They were written against the same stale picture, and sending
   them would apply edits on top of a state the user never saw.
 */
public actor SyncEngine {
    private let store: OutboxStore
    private let sender: OutboxSender

    /// After this many refusals an entry is something a person has to decide
    /// about, rather than something the app keeps trying.
    public let maxAttempts: Int

    private(set) public var state = SyncState()

    public init(store: OutboxStore, sender: OutboxSender, maxAttempts: Int = 5) {
        self.store = store
        self.sender = sender
        self.maxAttempts = maxAttempts
    }

    public func currentState() -> SyncState { state }

    /// Records a local change.
    public func enqueue(_ entry: OutboxEntry) async throws {
        try await store.append(entry)
        await refreshStatus()
    }

    /**
     * Recomputes the status from the store.
     *
     * Called on launch, when the in-memory status is `upToDate` simply because
     * nothing has happened yet — while the store may hold last night's unsent
     * work. Everything else keeps it current as a side effect of doing
     * something to the queue.
     */
    public func reloadStatus() async {
        await refreshStatus()
    }

    /// Everything still waiting, oldest first.
    public func pending() async -> [OutboxEntry] {
        (try? await store.pending()) ?? []
    }

    /// The queued writes of one kind, for a screen showing the user their own
    /// unsent work.
    public func pending(entityType: String) async -> [OutboxEntry] {
        (try? await store.pending(entityType: entityType)) ?? []
    }

    /**
     * Drops a queued change at the user's request.
     *
     * The only way out of a change the server will not accept. Deliberately a
     * separate verb from anything the engine does on its own: nothing here
     * throws away a person's work without them saying so.
     */
    public func discard(id: String) async throws {
        try await store.remove(id: id)
        try? await store.clearConflict(id: id)
        await refreshStatus()
    }

    /**
     * Empties the queue.
     *
     * For one situation only: the session ending. An entry is a request built
     * against `me/…` paths and carries no user of its own, so anything left
     * behind at sign-out would be sent as whoever signs in next — one person's
     * blood pressure filed in another person's record. The screen that offers
     * to sign out says what is about to be lost.
     */
    public func discardEverything() async {
        for entry in await pending() {
            try? await store.remove(id: entry.id)
        }

        for conflict in await conflicts() {
            try? await store.clearConflict(id: conflict.id)
        }

        state.lastSyncedAt = nil
        await refreshStatus()
    }

    @discardableResult
    public func sync() async -> SyncState {
        let entries = (try? await store.pending()) ?? []

        guard !entries.isEmpty else {
            await refreshStatus()
            return state
        }

        state.status = .syncing(remaining: entries.count)

        /// Records whose queue is blocked: either a conflict was just found, or
        /// a change is stuck. Later edits to them wait.
        var blocked = Set<String>()

        for entry in entries {
            let key = entry.recordKey

            if blocked.contains(key) {
                continue
            }

            switch await sender.send(entry) {
            case .applied:
                try? await store.remove(id: entry.id)

            case .conflict(let serverRecord, let serverVersion):
                try? await store.recordConflict(
                    SyncConflict(
                        local: entry.write,
                        serverRecord: serverRecord,
                        serverVersion: serverVersion
                    )
                )
                try? await store.remove(id: entry.id)
                blocked.insert(key)

            case .retryable(let message):
                // No point walking the rest of the queue: the same condition
                // will meet every one of them.
                var updated = entry
                updated.attempts += 1
                updated.lastError = message
                try? await store.update(updated)

                await refreshStatus()
                return state

            case .rejected(let message):
                var updated = entry
                updated.attempts += 1
                updated.lastError = message
                try? await store.update(updated)

                // Held rather than dropped. A change the server will not accept
                // is something the user must be told about, not something that
                // disappears.
                blocked.insert(key)
            }
        }

        state.lastSyncedAt = Date()
        await refreshStatus()
        return state
    }

    /// Called when the user has dealt with a conflict, either by keeping their
    /// version or the server's.
    public func resolveConflict(id: String, replayAs entry: OutboxEntry?) async throws {
        try await store.clearConflict(id: id)

        if let entry {
            try await store.append(entry)
        }

        await refreshStatus()
    }

    public func conflicts() async -> [SyncConflict] {
        (try? await store.conflicts()) ?? []
    }

    private func refreshStatus() async {
        let pending = (try? await store.pending()) ?? []
        let conflicts = (try? await store.conflicts()) ?? []
        let rejected = pending.filter { $0.attempts >= maxAttempts }

        if !conflicts.isEmpty || !rejected.isEmpty {
            state.status = .needsAttention(conflicts: conflicts.count, rejected: rejected.count)
        } else if pending.isEmpty {
            state.status = .upToDate
        } else {
            // Pending work with nothing wrong means we simply have not reached
            // the server yet.
            state.status = .offline(pending: pending.count)
        }
    }
}

public extension SendOutcome {
    /// Maps an API failure to the outcome the engine acts on.
    static func from(_ error: APIError) -> SendOutcome {
        switch error {
        case .offline, .timedOut, .server, .rateLimited:
            return .retryable(L10n.message(for: error))
        case .conflict:
            // A conflict without a parsed body is still a conflict; the caller
            // is expected to supply the server record where it can.
            return .rejected(L10n.message(for: error))
        default:
            return .rejected(L10n.message(for: error))
        }
    }
}

/**
 * The engine, seen from the networking layer.
 *
 * `APIClient` hands it a write it could not deliver and knows nothing else
 * about it — not that it is stored in SQLite, not that anything ever drains it.
 */
extension SyncEngine: PendingWriteQueue {
    public func enqueue(_ write: PendingWrite) async throws {
        try await enqueue(OutboxEntry(write: write))
    }
}

/// The queue, seen by a screen showing the user their own unsent work.
extension SyncEngine: PendingWriteReader {
    public func unsent(entityType: String) async -> [PendingWrite] {
        await pending(entityType: entityType).map(\.write)
    }
}
