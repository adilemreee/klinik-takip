import Foundation
import Network
import Observation
import KlinikAPI
import KlinikCore
import KlinikSync

/**
 * Says when the phone thinks it has a route to the internet.
 *
 * A protocol so the coordinator can be tested without one — and because a
 * route is a hint, not a promise: hotel wifi answers DNS and drops everything
 * else, which is why nothing here treats "reachable" as "the write will land".
 * It is a reason to try, and trying is what finds out.
 */
@MainActor
public protocol ReachabilityWatcher: AnyObject {
    func start(onChange: @escaping @MainActor (Bool) -> Void)
    func stop()
}

/// The real one.
@MainActor
public final class NetworkReachability: ReachabilityWatcher {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.klinik.reachability")
    private var running = false

    public init() {}

    public func start(onChange: @escaping @MainActor (Bool) -> Void) {
        guard !running else { return }
        running = true

        // Only a Bool crosses the boundary. The path object itself stays on
        // the monitor's queue, which keeps this free of the question of what
        // NWPath is isolated to on any given toolchain.
        monitor.pathUpdateHandler = { path in
            let reachable = path.status == .satisfied

            Task { @MainActor in onChange(reachable) }
        }

        monitor.start(queue: queue)
    }

    public func stop() {
        guard running else { return }

        running = false
        monitor.cancel()
    }
}

/**
 * Drains the offline queue, and is what the screens ask about it (spec M15).
 *
 * The engine decides what happens to each entry; this decides *when* to ask,
 * and holds the answer in a form a view can read. Three things start a run,
 * and none of them is a timer: the app coming to the front, the phone getting
 * a route to the internet, and a read reaching the clinic. Polling a server
 * that is not there costs a patient's battery in the hotel where the queue
 * filled up in the first place.
 */
@MainActor
@Observable
public final class SyncCoordinator {
    private let engine: SyncEngine
    private let files: UploadQueue?
    private let watcher: ReachabilityWatcher?

    public private(set) var status: SyncStatus = .upToDate
    public private(set) var pending: [OutboxEntry] = []
    public private(set) var conflicts: [SyncConflict] = []
    /// Files the connection could not carry (spec M15, T3.2).
    public private(set) var uploads: [PendingUpload] = []
    public private(set) var lastSyncedAt: Date?
    public private(set) var isSyncing = false

    /// Bumped every time a run finishes having sent something, so a screen can
    /// reload once rather than after every entry.
    public private(set) var appliedRevision = 0

    /// After this many refusals an entry needs a person.
    public let attemptLimit: Int

    /**
     * Why the queue is not on disk, when it is not.
     *
     * Surfaced rather than swallowed: with the store unopened everything still
     * works online, but a write made without a connection lives only in memory
     * and dies with the app — which is precisely the promise the queue exists
     * to keep.
     */
    public let storeFailure: String?

    public init(
        engine: SyncEngine,
        files: UploadQueue? = nil,
        watcher: ReachabilityWatcher? = nil,
        attemptLimit: Int = 5,
        storeFailure: String? = nil
    ) {
        self.engine = engine
        self.files = files
        self.watcher = watcher
        self.attemptLimit = attemptLimit
        self.storeFailure = storeFailure
    }

    /// Everything still waiting that nothing is wrong with.
    public var waiting: [OutboxEntry] {
        pending.filter { $0.attempts < attemptLimit }
    }

    /// Everything the clinic has refused often enough that trying again is not
    /// the answer. Shown apart, because these will not resolve themselves.
    public var stuck: [OutboxEntry] {
        pending.filter { $0.attempts >= attemptLimit }
    }

    /// Files that will not go on their own: refused too often, or whose bytes
    /// are no longer on the phone.
    public var stuckUploads: [PendingUpload] {
        uploads.filter { $0.attempts >= attemptLimit || !$0.fileExists }
    }

    public var waitingUploads: [PendingUpload] {
        uploads.filter { $0.attempts < attemptLimit && $0.fileExists }
    }

    public var needsAttention: Bool {
        !conflicts.isEmpty || !stuck.isEmpty || !stuckUploads.isEmpty
    }

    /// Everything the app is holding, of any kind. What the bar counts.
    public var heldCount: Int { pending.count + uploads.count }

    public var isHoldingSomething: Bool { heldCount > 0 || !conflicts.isEmpty }

    public func start() {
        watcher?.start { [weak self] reachable in
            guard reachable else { return }

            // A route appearing is the cheapest signal there is that the queue
            // is worth another pass.
            Task { await self?.sync() }
        }

        Task { await refresh() }
    }

    public func stop() {
        watcher?.stop()
    }

    /// Reads the queue without touching the network. What a screen calls when
    /// it appears.
    public func refresh() async {
        // On launch the engine's status is `upToDate` because nothing has
        // happened yet, while the store may hold last night's unsent work.
        await engine.reloadStatus()

        pending = await engine.pending()
        conflicts = await engine.conflicts()
        uploads = await files?.unfinished() ?? []

        let state = await engine.currentState()
        status = state.status
        lastSyncedAt = state.lastSyncedAt
    }

    /// One pass over the queue.
    ///
    /// Re-entrant calls are dropped rather than queued: the triggers overlap
    /// on purpose — coming to the front usually also means the network came
    /// back — and two passes at once would send the same entry twice.
    @discardableResult
    public func sync() async -> Bool {
        // The flag is raised in the same synchronous step as the check. An
        // `await` between the two would let a second caller through while the
        // first was suspended, which is how one entry gets sent twice.
        guard !isSyncing else { return false }
        isSyncing = true
        defer { isSyncing = false }

        // Asked of the engine, not of the copy this object is holding: a write
        // queued a moment ago by the API client is in the store before it is
        // in `pending`, and counting the stale copy would report "sent
        // nothing" on the run that sent it.
        let before = await engine.pending().count

        let state = await engine.sync()
        status = state.status
        lastSyncedAt = state.lastSyncedAt

        // Files after requests. A queued reading is one small call; a queued
        // scan can be twenty megabytes, and putting it first would leave the
        // quick work behind it on a connection that may not last.
        let filesSent = await files?.drain() ?? 0

        pending = await engine.pending()
        conflicts = await engine.conflicts()
        uploads = await files?.unfinished() ?? []

        let sent = before > pending.count || filesSent > 0

        if sent {
            appliedRevision += 1
        }

        return sent
    }

    /**
     * Called when a read reaches the clinic.
     *
     * The connection is demonstrably there, which is better evidence than any
     * reachability API. Asked of the engine rather than of the copy this
     * object holds: a write queued a moment ago is in the store before it is
     * in `pending`, and the whole point of this trigger is the write that was
     * just made. The engine keeps its status in memory, so this costs an actor
     * hop and no disk.
     */
    public func connectionProved() {
        guard !isSyncing else { return }

        Task { [engine] in
            let idle = await engine.currentState().status == .upToDate && uploads.isEmpty

            guard !idle else { return }

            await sync()
        }
    }

    /**
     * Drops a queued change at the user's request.
     *
     * The only way anything leaves this queue unsent. Nothing here throws away
     * a person's work on its own — not after ten failed attempts, not after a
     * week — because the app cannot know whether the thing it is holding is a
     * duplicate or the only record that a wound looked wrong on Tuesday.
     */
    public func discard(id: String) async {
        try? await engine.discard(id: id)
        await refresh()
    }

    /// Drops a queued file, and the copy of it this app was keeping.
    public func discardUpload(id: String) async {
        await files?.discard(id: id)
        await refresh()
    }

    /**
     * Empties the queue as the session ends.
     *
     * Not a tidy-up: an entry is a request against `me/…` and carries no user
     * of its own, so anything left here would be sent as whoever signs in
     * next. The sign-out button says how many entries this loses before it
     * asks.
     */
    public func clearForSignOut() async {
        await engine.discardEverything()
        // And the files. They are one person's medical documents sitting in a
        // directory this app owns; leaving them for the next account is worse
        // than losing them.
        await files?.discardEverything()
        await refresh()
    }

    /// Keeps the user's version by queueing it again, against what the server
    /// has now.

    public func resendMine(_ conflict: SyncConflict) async {
        try? await engine.resolveConflict(id: conflict.id, replayAs: OutboxEntry(write: conflict.local))
        await refresh()
    }

    /// Accepts the clinic's version and drops the local one.
    public func keepTheirs(_ conflict: SyncConflict) async {
        try? await engine.resolveConflict(id: conflict.id, replayAs: nil)
        await refresh()
    }
}


/**
 * The queue, as the API client sees it.
 *
 * The client hands writes here rather than straight to the engine so that the
 * bar at the top of the screen appears the moment something is kept. Told
 * later — on the next refresh — it would mean a patient records a reading with
 * no signal and is shown nothing at all until they navigate somewhere.
 */
extension SyncCoordinator: PendingWriteQueue {
    public func enqueue(_ write: PendingWrite) async throws {
        try await engine.enqueue(write)
        await refresh()
    }
}
