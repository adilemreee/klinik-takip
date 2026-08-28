import XCTest
import KlinikCore
@testable import KlinikSync

/// Answers per entry id, and records what it was asked to send.
private actor ScriptedSender: OutboxSender {
    private var outcomes: [String: SendOutcome]
    private let fallback: SendOutcome
    private(set) var sentIds: [String] = []

    init(outcomes: [String: SendOutcome] = [:], fallback: SendOutcome = .applied) {
        self.outcomes = outcomes
        self.fallback = fallback
    }

    func send(_ entry: OutboxEntry) async -> SendOutcome {
        sentIds.append(entry.id)
        return outcomes[entry.id] ?? fallback
    }

    func sent() -> [String] { sentIds }
}

final class SyncEngineTests: XCTestCase {
    private func entry(
        _ id: String,
        entity: String = "patients",
        record: String = "p1",
        version: Int? = 1,
        createdAt: Date = Date()
    ) -> OutboxEntry {
        OutboxEntry(
            id: id,
            entityType: entity,
            entityId: record,
            payload: Data(#"{"city":"Berlin"}"#.utf8),
            baseVersion: version,
            createdAt: createdAt
        )
    }

    private func engine(
        _ sender: OutboxSender,
        maxAttempts: Int = 5
    ) -> (SyncEngine, InMemoryOutboxStore) {
        let store = InMemoryOutboxStore()
        return (SyncEngine(store: store, sender: sender, maxAttempts: maxAttempts), store)
    }

    /// The user's edit is already visible locally; the queue is what still owes
    /// the server.
    func testEnqueuedWorkShowsAsPending() async throws {
        let (engine, _) = self.engine(ScriptedSender())

        try await engine.enqueue(entry("e1"))

        let state = await engine.currentState()
        XCTAssertEqual(state.status, .offline(pending: 1))
    }

    func testASuccessfulSyncEmptiesTheQueue() async throws {
        let (engine, store) = self.engine(ScriptedSender())
        try await engine.enqueue(entry("e1"))

        let state = await engine.sync()

        XCTAssertEqual(state.status, .upToDate)
        let pending = try await store.pending()
        XCTAssertTrue(pending.isEmpty)
        XCTAssertNotNil(state.lastSyncedAt)
    }

    /// Edits to one record must reach the server in the order they were made,
    /// or a later correction can be undone by an earlier one.
    func testSendsOldestFirst() async throws {
        let sender = ScriptedSender()
        let (engine, _) = self.engine(sender)
        let now = Date()

        try await engine.enqueue(entry("newer", createdAt: now))
        try await engine.enqueue(entry("older", createdAt: now.addingTimeInterval(-60)))

        _ = await engine.sync()

        let sent = await sender.sent()
        XCTAssertEqual(sent, ["older", "newer"])
    }

    // MARK: - Conflicts

    /// Spec M15: refused work is kept, not discarded.
    func testAConflictIsRecordedRatherThanDropped() async throws {
        let serverRecord = Data(#"{"city":"Hamburg","version":3}"#.utf8)
        let sender = ScriptedSender(
            outcomes: ["e1": .conflict(serverRecord: serverRecord, serverVersion: 3)]
        )
        let (engine, store) = self.engine(sender)
        try await engine.enqueue(entry("e1"))

        _ = await engine.sync()

        let conflicts = await engine.conflicts()
        XCTAssertEqual(conflicts.count, 1)
        XCTAssertEqual(conflicts.first?.serverVersion, 3)
        // Both sides are kept so the screen can show them together.
        XCTAssertEqual(conflicts.first?.serverRecord, serverRecord)
        XCTAssertEqual(conflicts.first?.localPayload, Data(#"{"city":"Berlin"}"#.utf8))

        let pending = try await store.pending()
        XCTAssertTrue(pending.isEmpty, "A conflicted entry does not stay queued as-is")
    }

    func testAConflictAsksForAPerson() async throws {
        let sender = ScriptedSender(
            outcomes: ["e1": .conflict(serverRecord: Data("{}".utf8), serverVersion: 2)]
        )
        let (engine, _) = self.engine(sender)
        try await engine.enqueue(entry("e1"))

        let state = await engine.sync()

        XCTAssertEqual(state.status, .needsAttention(conflicts: 1, rejected: 0))
    }

    /**
     The subtle rule.

     The later edits were written against the same stale picture. Sending them
     would apply changes on top of a state the user never saw — which is the
     silent overwrite spec M15 exists to prevent, just one step removed.
     */
    func testAConflictHoldsBackLaterEditsToTheSameRecord() async throws {
        let sender = ScriptedSender(
            outcomes: ["e1": .conflict(serverRecord: Data("{}".utf8), serverVersion: 2)]
        )
        let (engine, _) = self.engine(sender)
        let now = Date()

        try await engine.enqueue(entry("e1", record: "p1", createdAt: now.addingTimeInterval(-60)))
        try await engine.enqueue(entry("e2", record: "p1", createdAt: now))

        _ = await engine.sync()

        let sent = await sender.sent()
        XCTAssertEqual(sent, ["e1"], "The second edit to the same record must wait")
    }

    /// Blocking is per record: a conflict on one patient must not stall
    /// everyone else's work.
    func testAConflictDoesNotHoldBackOtherRecords() async throws {
        let sender = ScriptedSender(
            outcomes: ["e1": .conflict(serverRecord: Data("{}".utf8), serverVersion: 2)]
        )
        let (engine, _) = self.engine(sender)
        let now = Date()

        try await engine.enqueue(entry("e1", record: "p1", createdAt: now.addingTimeInterval(-60)))
        try await engine.enqueue(entry("e2", record: "p2", createdAt: now))

        _ = await engine.sync()

        let sent = await sender.sent()
        XCTAssertEqual(sent, ["e1", "e2"])
    }

    func testResolvingAConflictClearsIt() async throws {
        let sender = ScriptedSender(
            outcomes: ["e1": .conflict(serverRecord: Data("{}".utf8), serverVersion: 2)]
        )
        let (engine, _) = self.engine(sender)
        try await engine.enqueue(entry("e1"))
        _ = await engine.sync()

        try await engine.resolveConflict(id: "e1", replayAs: nil)

        let conflicts = await engine.conflicts()
        XCTAssertTrue(conflicts.isEmpty)
        let state = await engine.currentState()
        XCTAssertEqual(state.status, .upToDate)
    }

    /// Keeping the local version means replaying it against the version the
    /// server now has.
    func testResolvingCanReplayTheEditAgainstTheNewVersion() async throws {
        let sender = ScriptedSender(
            outcomes: ["e1": .conflict(serverRecord: Data("{}".utf8), serverVersion: 3)]
        )
        let (engine, store) = self.engine(sender)
        try await engine.enqueue(entry("e1"))
        _ = await engine.sync()

        try await engine.resolveConflict(id: "e1", replayAs: entry("e1-replay", version: 3))

        let pending = try await store.pending()
        XCTAssertEqual(pending.map(\.id), ["e1-replay"])
        XCTAssertEqual(pending.first?.baseVersion, 3)
    }

    // MARK: - Failures

    /// No point walking the rest of the queue: the same condition meets them all.
    func testAnOfflineFailureStopsTheRunAndKeepsEverything() async throws {
        let sender = ScriptedSender(fallback: .retryable("offline"))
        let (engine, store) = self.engine(sender)
        let now = Date()

        try await engine.enqueue(entry("e1", record: "p1", createdAt: now.addingTimeInterval(-60)))
        try await engine.enqueue(entry("e2", record: "p2", createdAt: now))

        let state = await engine.sync()

        let sent = await sender.sent()
        XCTAssertEqual(sent, ["e1"], "The run stops at the first connection failure")

        let pending = try await store.pending()
        XCTAssertEqual(pending.count, 2, "Nothing is lost")
        XCTAssertEqual(state.status, .offline(pending: 2))
    }

    func testARetryableFailureIsTriedAgainOnTheNextRun() async throws {
        let sender = ScriptedSender(fallback: .retryable("offline"))
        let (engine, store) = self.engine(sender)
        try await engine.enqueue(entry("e1"))

        _ = await engine.sync()
        _ = await engine.sync()

        let entries = try await store.pending()
        XCTAssertEqual(entries.first?.attempts, 2)
    }

    /// A change the server will not accept is something the user must be told
    /// about, not something that quietly disappears.
    func testARejectedChangeIsKeptAndSurfaced() async throws {
        let sender = ScriptedSender(fallback: .rejected("validation failed"))
        let (engine, store) = self.engine(sender, maxAttempts: 1)
        try await engine.enqueue(entry("e1"))

        let state = await engine.sync()

        let pending = try await store.pending()
        XCTAssertEqual(pending.count, 1)
        XCTAssertEqual(pending.first?.lastError, "validation failed")
        XCTAssertEqual(state.status, .needsAttention(conflicts: 0, rejected: 1))
    }

    /// One stuck change must not stall every other record's queue.
    func testARejectedChangeDoesNotBlockOtherRecords() async throws {
        let sender = ScriptedSender(
            outcomes: ["e1": .rejected("validation failed")],
            fallback: .applied
        )
        let (engine, _) = self.engine(sender)
        let now = Date()

        try await engine.enqueue(entry("e1", record: "p1", createdAt: now.addingTimeInterval(-60)))
        try await engine.enqueue(entry("e2", record: "p2", createdAt: now))

        _ = await engine.sync()

        let sent = await sender.sent()
        XCTAssertEqual(sent, ["e1", "e2"])
    }

    func testAnEmptyQueueReportsUpToDate() async {
        let (engine, _) = self.engine(ScriptedSender())

        let state = await engine.sync()

        XCTAssertEqual(state.status, .upToDate)
    }

    /// Whatever happens, queued work is either sent, held for retry, or shown
    /// to the user — never dropped on the floor.
    func testNothingIsEverSilentlyLost() async throws {
        let sender = ScriptedSender(
            outcomes: [
                "ok": .applied,
                "conflict": .conflict(serverRecord: Data("{}".utf8), serverVersion: 2),
                "rejected": .rejected("no"),
            ],
            fallback: .applied
        )
        let (engine, store) = self.engine(sender, maxAttempts: 1)
        let now = Date()

        try await engine.enqueue(entry("ok", record: "a", createdAt: now.addingTimeInterval(-30)))
        try await engine.enqueue(entry("conflict", record: "b", createdAt: now.addingTimeInterval(-20)))
        try await engine.enqueue(entry("rejected", record: "c", createdAt: now.addingTimeInterval(-10)))

        _ = await engine.sync()

        let pending = try await store.pending()
        let conflicts = await engine.conflicts()

        // Applied: gone. Conflicted: in the conflict list. Rejected: still
        // queued with its reason. Three in, three accounted for.
        XCTAssertEqual(pending.count + conflicts.count, 2)
        XCTAssertEqual(conflicts.map(\.id), ["conflict"])
        XCTAssertEqual(pending.map(\.id), ["rejected"])
    }
}
