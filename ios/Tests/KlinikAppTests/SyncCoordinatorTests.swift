import XCTest
import KlinikAPI
import KlinikCore
import KlinikSync
@testable import KlinikApp

/// Answers however the test says, and counts what it was asked to send.
private actor ScriptedSender: OutboxSender {
    private var outcomes: [String: SendOutcome]
    private let fallback: SendOutcome
    private(set) var sent: [String] = []

    init(outcomes: [String: SendOutcome] = [:], fallback: SendOutcome = .applied) {
        self.outcomes = outcomes
        self.fallback = fallback
    }

    func send(_ entry: OutboxEntry) async -> SendOutcome {
        sent.append(entry.id)
        return outcomes[entry.id] ?? fallback
    }

    func attempts() -> [String] { sent }
}

/// A reachability source the test drives by hand.
@MainActor
private final class ManualReachability: ReachabilityWatcher {
    private var handler: ((Bool) -> Void)?
    private(set) var stopped = false

    func start(onChange: @escaping @MainActor (Bool) -> Void) {
        handler = onChange
    }

    func stop() { stopped = true }

    func report(_ reachable: Bool) { handler?(reachable) }
}

/**
 * What the shell does with the queue (spec M15).
 *
 * The engine decides what happens to each entry; this decides when to ask and
 * what a person is shown. The rules worth protecting are that nothing leaves
 * the queue unsent without somebody saying so, and that entries the clinic
 * keeps refusing are separated from the ones simply waiting for a connection —
 * a list where the two look alike is a list nobody acts on.
 */
@MainActor
final class SyncCoordinatorTests: XCTestCase {
    private func write(_ id: String, entity: String = "measurement") -> PendingWrite {
        PendingWrite(
            ticket: QueuedWrite(
                entityType: entity,
                entityId: id,
                summary: "Ölçüm: Kilo",
                id: id
            ),
            method: .post,
            path: "me/measurements",
            body: Data(#"{"value":78.4}"#.utf8)
        )
    }

    private func coordinator(
        _ sender: OutboxSender,
        watcher: ReachabilityWatcher? = nil,
        attemptLimit: Int = 5
    ) -> (SyncCoordinator, SyncEngine) {
        let engine = SyncEngine(
            store: InMemoryOutboxStore(),
            sender: sender,
            maxAttempts: attemptLimit
        )

        return (
            SyncCoordinator(engine: engine, watcher: watcher, attemptLimit: attemptLimit),
            engine
        )
    }

    /// The bar at the top of the screen has to appear the moment something is
    /// kept. Told later, a patient who records a reading with no signal is
    /// shown nothing at all until they navigate somewhere.
    func testAQueuedWriteShowsUpWithoutWaitingForARefresh() async throws {
        let (sync, _) = coordinator(ScriptedSender())

        try await sync.enqueue(write("w1"))

        XCTAssertEqual(sync.pending.map(\.id), ["w1"])
    }

    /// On launch nothing has happened yet, so the engine's own status says
    /// "up to date" while the store holds last night's unsent work.
    func testACoolStartReportsWhatIsActuallyInTheStore() async throws {
        let store = InMemoryOutboxStore()
        try await store.append(OutboxEntry(write: write("w1")))

        let engine = SyncEngine(store: store, sender: ScriptedSender(), maxAttempts: 5)
        let sync = SyncCoordinator(engine: engine, attemptLimit: 5)

        await sync.refresh()

        XCTAssertEqual(sync.pending.map(\.id), ["w1"])
        XCTAssertEqual(sync.status, .offline(pending: 1))
    }

    func testWhatIsWaitingIsShown() async throws {
        let (sync, engine) = coordinator(ScriptedSender())
        try await engine.enqueue(write("w1"))

        await sync.refresh()

        XCTAssertEqual(sync.pending.map(\.id), ["w1"])
        XCTAssertEqual(sync.waiting.map(\.id), ["w1"])
        XCTAssertTrue(sync.stuck.isEmpty)
        XCTAssertFalse(sync.needsAttention)
    }

    /// Two lists, because the remedies are different: one needs a connection,
    /// the other needs a person.
    func testSomethingTheClinicKeepsRefusingIsListedApart() async throws {
        let sender = ScriptedSender(fallback: .rejected("Kilo 500 kg olamaz"))
        let (sync, engine) = coordinator(sender, attemptLimit: 2)
        try await engine.enqueue(write("w1"))

        await sync.sync()
        await sync.sync()

        XCTAssertEqual(sync.stuck.map(\.id), ["w1"])
        XCTAssertTrue(sync.waiting.isEmpty)
        XCTAssertTrue(sync.needsAttention)
        XCTAssertEqual(sync.stuck.first?.lastError, "Kilo 500 kg olamaz")
    }

    func testASuccessfulRunEmptiesTheQueue() async throws {
        let (sync, engine) = coordinator(ScriptedSender())
        try await engine.enqueue(write("w1"))

        let sentSomething = await sync.sync()

        XCTAssertTrue(sentSomething)
        XCTAssertTrue(sync.pending.isEmpty)
        XCTAssertEqual(sync.status, .upToDate)
        XCTAssertNotNil(sync.lastSyncedAt)
    }

    /// The triggers overlap on purpose — coming to the front usually also
    /// means the network came back — and two passes at once would send the
    /// same entry twice.
    func testTwoRunsAtOnceDoNotSendTheSameEntryTwice() async throws {
        let sender = ScriptedSender()
        let (sync, engine) = coordinator(sender)
        try await engine.enqueue(write("w1"))

        async let first = sync.sync()
        async let second = sync.sync()
        _ = await (first, second)

        let attempts = await sender.attempts()
        XCTAssertEqual(attempts, ["w1"])
    }

    func testAConnectionComingBackDrainsTheQueue() async throws {
        let watcher = ManualReachability()
        let sender = ScriptedSender()
        let (sync, engine) = coordinator(sender, watcher: watcher)
        try await engine.enqueue(write("w1"))

        sync.start()
        watcher.report(true)

        // The watcher hands off to a task; give it a turn.
        try await Task.sleep(nanoseconds: 50_000_000)

        let attempts = await sender.attempts()
        XCTAssertEqual(attempts, ["w1"])
    }

    func testLosingTheConnectionDoesNotStartARun() async throws {
        let watcher = ManualReachability()
        let sender = ScriptedSender()
        let (sync, engine) = coordinator(sender, watcher: watcher)
        try await engine.enqueue(write("w1"))

        sync.start()
        watcher.report(false)
        try await Task.sleep(nanoseconds: 50_000_000)

        let attempts = await sender.attempts()
        XCTAssertTrue(attempts.isEmpty)
    }

    // MARK: - Losing work on purpose

    func testDiscardingIsTheOnlyWayWorkLeavesTheQueueUnsent() async throws {
        let sender = ScriptedSender(fallback: .rejected("olmaz"))
        let (sync, engine) = coordinator(sender, attemptLimit: 1)
        try await engine.enqueue(write("w1"))

        // Ten refusals later it is still there, because nothing here throws
        // away a person's work on its own.
        for _ in 0..<10 { await sync.sync() }
        XCTAssertEqual(sync.pending.count, 1)

        await sync.discard(id: "w1")

        XCTAssertTrue(sync.pending.isEmpty)
    }

    /// An entry is a request against `me/…` and carries no user of its own.
    /// Left behind, it would be sent as whoever signs in next.
    func testSigningOutEmptiesTheQueue() async throws {
        let (sync, engine) = coordinator(ScriptedSender(fallback: .retryable("offline")))
        try await engine.enqueue(write("w1"))
        try await engine.enqueue(write("w2"))
        await sync.refresh()
        XCTAssertEqual(sync.pending.count, 2)

        await sync.clearForSignOut()

        XCTAssertTrue(sync.pending.isEmpty)
        XCTAssertTrue(sync.conflicts.isEmpty)
    }

    // MARK: - Conflicts

    func testKeepingMineQueuesTheEditAgain() async throws {
        let sender = ScriptedSender(
            outcomes: ["w1": .conflict(serverRecord: Data("{}".utf8), serverVersion: 4)]
        )
        let (sync, engine) = coordinator(sender)
        try await engine.enqueue(write("w1"))
        await sync.sync()

        let conflict = try XCTUnwrap(sync.conflicts.first)
        await sync.resendMine(conflict)

        XCTAssertTrue(sync.conflicts.isEmpty)
        XCTAssertEqual(sync.pending.map(\.id), ["w1"])
    }

    func testKeepingTheirsDropsTheLocalEdit() async throws {
        let sender = ScriptedSender(
            outcomes: ["w1": .conflict(serverRecord: Data("{}".utf8), serverVersion: 4)]
        )
        let (sync, engine) = coordinator(sender)
        try await engine.enqueue(write("w1"))
        await sync.sync()

        let conflict = try XCTUnwrap(sync.conflicts.first)
        await sync.keepTheirs(conflict)

        XCTAssertTrue(sync.conflicts.isEmpty)
        XCTAssertTrue(sync.pending.isEmpty)
    }
}
