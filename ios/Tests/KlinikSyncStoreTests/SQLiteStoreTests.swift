import XCTest
import KlinikSync
@testable import KlinikSyncStore

/**
 * The offline queue on disk (spec M15, T2.6).
 *
 * The first test is the whole point of the file: everything the sync engine
 * holds is work the user has already done, and in memory all of it dies when
 * the phone reclaims the app — which is exactly when the connection was bad
 * enough for the queue to be full in the first place.
 *
 * These run against real SQLite, not a fake. A store that passes against a
 * mock of itself has tested nothing.
 */
final class SQLiteStoreTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private var fileURL: URL { directory.appendingPathComponent("sync.sqlite") }

    private func entry(
        _ id: String,
        entityId: String = "p1",
        createdAt: Date = Date(),
        attempts: Int = 0
    ) -> OutboxEntry {
        OutboxEntry(
            id: id,
            entityType: "patients",
            entityId: entityId,
            payload: Data("{\"note\":\"ağrı var\"}".utf8),
            baseVersion: 3,
            createdAt: createdAt,
            attempts: attempts
        )
    }

    // MARK: - Surviving a restart

    func testTheQueueIsStillThereAfterTheAppIsKilled() async throws {
        let first = try SQLiteStore(url: fileURL)
        try await SQLiteOutboxStore(store: first).append(entry("e1"))

        // A new store on the same file is what a relaunch looks like.
        let afterRelaunch = SQLiteOutboxStore(store: try SQLiteStore(url: fileURL))
        let pending = try await afterRelaunch.pending()

        XCTAssertEqual(pending.map(\.id), ["e1"])
        XCTAssertEqual(pending[0].baseVersion, 3)
        XCTAssertEqual(
            String(decoding: pending[0].payload, as: UTF8.self),
            "{\"note\":\"ağrı var\"}"
        )
    }

    func testAConflictSurvivesTooBecauseSomebodyStillHasToDecide() async throws {
        // Spec M15: the user's work is never silently thrown away, and losing
        // it to a restart is throwing it away.
        let store = SQLiteOutboxStore(store: try SQLiteStore(url: fileURL))
        try await store.recordConflict(
            SyncConflict(
                id: "c1",
                entityType: "patients",
                entityId: "p1",
                localPayload: Data("mine".utf8),
                serverRecord: Data("theirs".utf8),
                serverVersion: 4
            )
        )

        let afterRelaunch = SQLiteOutboxStore(store: try SQLiteStore(url: fileURL))
        let conflicts = try await afterRelaunch.conflicts()

        XCTAssertEqual(conflicts.map(\.id), ["c1"])
        XCTAssertEqual(conflicts[0].serverVersion, 4)
    }

    func testAnUnfinishedUploadSurvives() async throws {
        // Resuming needs the mapping from server session to local file. Held in
        // memory it dies with the process, and a patient uploading a 20 MB scan
        // starts again from nothing.
        let store = SQLiteUploadStore(store: try SQLiteStore(url: fileURL))
        try await store.remember(
            PendingUpload(
                id: "s1",
                fileURL: URL(fileURLWithPath: "/tmp/scan.pdf"),
                patientId: "p1",
                originalName: "tahlil.pdf",
                totalBytes: 20_000_000
            )
        )

        let afterRelaunch = SQLiteUploadStore(store: try SQLiteStore(url: fileURL))
        let unfinished = try await afterRelaunch.unfinished()

        XCTAssertEqual(unfinished.map(\.id), ["s1"])
        XCTAssertEqual(unfinished[0].fileURL.path, "/tmp/scan.pdf")
        XCTAssertEqual(unfinished[0].totalBytes, 20_000_000)
    }

    // MARK: - Ordering

    func testSendsTheOldestEditFirst() async throws {
        // Edits to one record must reach the server in the order they were
        // made, or a later correction is undone by an earlier one.
        let store = SQLiteOutboxStore(store: try SQLiteStore())
        let base = Date(timeIntervalSince1970: 1_800_000_000)

        try await store.append(entry("later", createdAt: base.addingTimeInterval(60)))
        try await store.append(entry("earlier", createdAt: base))
        try await store.append(entry("latest", createdAt: base.addingTimeInterval(120)))

        let ids = try await store.pending().map(\.id)
        XCTAssertEqual(ids, ["earlier", "later", "latest"])
    }

    func testUnfinishedUploadsComeBackOldestFirst() async throws {
        let store = SQLiteUploadStore(store: try SQLiteStore())
        let base = Date(timeIntervalSince1970: 1_800_000_000)

        for (id, offset) in [("b", 60.0), ("a", 0.0)] {
            try await store.remember(
                PendingUpload(
                    id: id,
                    fileURL: URL(fileURLWithPath: "/tmp/\(id)"),
                    originalName: "\(id).pdf",
                    totalBytes: 10,
                    startedAt: base.addingTimeInterval(offset)
                )
            )
        }

        let ids = try await store.unfinished().map(\.id)
        XCTAssertEqual(ids, ["a", "b"])
    }

    // MARK: - The queue as the engine uses it

    func testRecordsAFailedAttemptWithoutLosingTheEdit() async throws {
        let store = SQLiteOutboxStore(store: try SQLiteStore(url: fileURL))
        try await store.append(entry("e1"))

        var failed = try await store.pending()[0]
        failed.attempts = 2
        failed.lastError = "bağlantı yok"
        try await store.update(failed)

        let afterRelaunch = SQLiteOutboxStore(store: try SQLiteStore(url: fileURL))
        let pending = try await afterRelaunch.pending()

        XCTAssertEqual(pending[0].attempts, 2)
        XCTAssertEqual(pending[0].lastError, "bağlantı yok")
    }

    func testRemovesAnEditOnceItHasLanded() async throws {
        let store = SQLiteOutboxStore(store: try SQLiteStore())
        try await store.append(entry("e1"))
        try await store.append(entry("e2"))

        try await store.remove(id: "e1")

        let remaining = try await store.pending().map(\.id)
        XCTAssertEqual(remaining, ["e2"])
    }

    func testQueueingTheSameEditTwiceDoesNotQueueItTwice() async throws {
        // A retry that re-queues the same edit must not send it twice.
        let store = SQLiteOutboxStore(store: try SQLiteStore())
        try await store.append(entry("e1", entityId: "p1"))
        try await store.append(entry("e1", entityId: "p2"))

        let pending = try await store.pending()
        XCTAssertEqual(pending.count, 1)
        XCTAssertEqual(pending[0].entityId, "p2")
    }

    func testUpdatingSomethingAlreadySentDoesNotResurrectIt() async throws {
        let store = SQLiteOutboxStore(store: try SQLiteStore())
        var sent = entry("e1")
        try await store.append(sent)
        try await store.remove(id: "e1")

        sent.attempts = 1
        try await store.update(sent)

        let pending = try await store.pending()
        XCTAssertTrue(pending.isEmpty)
    }

    func testClearingAConflictLeavesTheOthers() async throws {
        let store = SQLiteOutboxStore(store: try SQLiteStore())

        for id in ["c1", "c2"] {
            try await store.recordConflict(
                SyncConflict(
                    id: id,
                    entityType: "patients",
                    entityId: "p1",
                    localPayload: Data(),
                    serverRecord: Data(),
                    serverVersion: 1
                )
            )
        }

        try await store.clearConflict(id: "c1")

        let remaining = try await store.conflicts().map(\.id)
        XCTAssertEqual(remaining, ["c2"])
    }

    func testForgettingAnUploadLeavesTheOthers() async throws {
        let store = SQLiteUploadStore(store: try SQLiteStore())

        for id in ["s1", "s2"] {
            try await store.remember(
                PendingUpload(
                    id: id,
                    fileURL: URL(fileURLWithPath: "/tmp/\(id)"),
                    originalName: "\(id).pdf",
                    totalBytes: 1
                )
            )
        }

        try await store.forget(id: "s1")

        let remaining = try await store.unfinished().map(\.id)
        XCTAssertEqual(remaining, ["s2"])
    }

    // MARK: - The file itself

    func testOpeningAnExistingFileAgainDoesNotWipeIt() async throws {
        // The migrator runs on every open; a "create table" that was not a
        // migration would quietly start the queue over on the second launch.
        let store = SQLiteOutboxStore(store: try SQLiteStore(url: fileURL))
        try await store.append(entry("e1"))

        for _ in 0..<3 {
            _ = try SQLiteStore(url: fileURL)
        }

        let afterRelaunch = SQLiteOutboxStore(store: try SQLiteStore(url: fileURL))
        let pending = try await afterRelaunch.pending()
        XCTAssertEqual(pending.count, 1)
    }

    func testTheDefaultLocationIsTheAppsOwnBookkeepingNotTheUsersDocuments() throws {
        let url = try SQLiteStore.defaultURL()

        XCTAssertTrue(url.path.contains("Application Support"))
        XCTAssertEqual(url.lastPathComponent, "sync.sqlite")
    }

    func testTwoStoresOnOneFileBothSeeTheQueue() async throws {
        // The queue is written by a background sync and read by the UI.
        let writer = SQLiteOutboxStore(store: try SQLiteStore(url: fileURL))
        let reader = SQLiteOutboxStore(store: try SQLiteStore(url: fileURL))

        try await writer.append(entry("e1"))

        let seen = try await reader.pending().map(\.id)
        XCTAssertEqual(seen, ["e1"])
    }
}
