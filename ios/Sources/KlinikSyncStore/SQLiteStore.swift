import Foundation
import GRDB
import KlinikSync

/**
 * The offline queue's home on disk (spec M15, T2.6).
 *
 * Everything the sync engine holds is work the user has already done: an edit
 * typed on a ward round with no signal, a conflict waiting for somebody to
 * decide, a half-finished upload. In memory, all of it dies when the phone
 * decides to reclaim the app — which is exactly when the connection was bad
 * enough for the queue to be full in the first place.
 *
 * One SQLite file, two ports implemented against it, and the schema versioned
 * so a future column is a migration rather than a lost queue.
 */
public actor SQLiteStore {
    private let queue: DatabaseQueue

    /// The store's file, under Application Support rather than Documents:
    /// this is the app's own bookkeeping, not the user's documents.
    public static func defaultURL(fileManager: FileManager = .default) throws -> URL {
        let directory = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        .appendingPathComponent("Klinik", isDirectory: true)

        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)

        return directory.appendingPathComponent("sync.sqlite")
    }

    public init(url: URL) throws {
        var configuration = Configuration()

        // The queue is written from a background sync and read by the UI; the
        // default busy timeout of zero turns ordinary contention into an error.
        configuration.busyMode = .timeout(5)

        queue = try DatabaseQueue(path: url.path, configuration: configuration)
        try Self.migrator.migrate(queue)
    }

    /// In-memory SQLite, for tests that want the real engine without a file.
    public init() throws {
        queue = try DatabaseQueue()
        try Self.migrator.migrate(queue)
    }

    /**
     * Schema versions.
     *
     * Registered rather than "create table if not exists", so adding a column
     * later is a migration somebody wrote instead of a table that silently
     * differs between a fresh install and an upgrade.
     */
    private static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()

        migrator.registerMigration("v1") { database in
            try database.create(table: "outbox") { table in
                table.primaryKey("id", .text)
                table.column("entityType", .text).notNull()
                table.column("entityId", .text).notNull()
                table.column("operation", .text).notNull()
                table.column("payload", .blob).notNull()
                table.column("baseVersion", .integer)
                table.column("createdAt", .datetime).notNull()
                table.column("attempts", .integer).notNull().defaults(to: 0)
                table.column("lastError", .text)
            }

            // Sending is always "oldest first", so the order is an index rather
            // than a sort of the whole queue on every pass.
            try database.create(index: "outbox_createdAt", on: "outbox", columns: ["createdAt"])

            try database.create(table: "conflict") { table in
                table.primaryKey("id", .text)
                table.column("entityType", .text).notNull()
                table.column("entityId", .text).notNull()
                table.column("localPayload", .blob).notNull()
                table.column("serverRecord", .blob).notNull()
                table.column("serverVersion", .integer).notNull()
                table.column("detectedAt", .datetime).notNull()
            }

            try database.create(table: "upload") { table in
                table.primaryKey("id", .text)
                table.column("fileURL", .text).notNull()
                table.column("patientId", .text)
                table.column("originalName", .text).notNull()
                table.column("totalBytes", .integer).notNull()
                table.column("startedAt", .datetime).notNull()
            }
        }

        return migrator
    }

    fileprivate func read<T>(_ work: @Sendable (Database) throws -> T) throws -> T {
        try queue.read(work)
    }

    fileprivate func write<T>(_ work: @Sendable (Database) throws -> T) throws -> T {
        try queue.write(work)
    }
}

// MARK: - Rows

private struct OutboxRow: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "outbox"

    var id: String
    var entityType: String
    var entityId: String
    var operation: String
    var payload: Data
    var baseVersion: Int?
    var createdAt: Date
    var attempts: Int
    var lastError: String?

    init(_ entry: OutboxEntry) {
        id = entry.id
        entityType = entry.entityType
        entityId = entry.entityId
        operation = entry.operation.rawValue
        payload = entry.payload
        baseVersion = entry.baseVersion
        createdAt = entry.createdAt
        attempts = entry.attempts
        lastError = entry.lastError
    }

    /// An unreadable operation would otherwise become a silently dropped edit.
    var entry: OutboxEntry? {
        guard let operation = OutboxEntry.Operation(rawValue: operation) else { return nil }

        return OutboxEntry(
            id: id,
            entityType: entityType,
            entityId: entityId,
            operation: operation,
            payload: payload,
            baseVersion: baseVersion,
            createdAt: createdAt,
            attempts: attempts,
            lastError: lastError
        )
    }
}

private struct ConflictRow: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "conflict"

    var id: String
    var entityType: String
    var entityId: String
    var localPayload: Data
    var serverRecord: Data
    var serverVersion: Int
    var detectedAt: Date

    init(_ conflict: SyncConflict) {
        id = conflict.id
        entityType = conflict.entityType
        entityId = conflict.entityId
        localPayload = conflict.localPayload
        serverRecord = conflict.serverRecord
        serverVersion = conflict.serverVersion
        detectedAt = conflict.detectedAt
    }

    var conflict: SyncConflict {
        SyncConflict(
            id: id,
            entityType: entityType,
            entityId: entityId,
            localPayload: localPayload,
            serverRecord: serverRecord,
            serverVersion: serverVersion,
            detectedAt: detectedAt
        )
    }
}

private struct UploadRow: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "upload"

    var id: String
    var fileURL: String
    var patientId: String?
    var originalName: String
    var totalBytes: Int
    var startedAt: Date

    init(_ upload: PendingUpload) {
        id = upload.id
        fileURL = upload.fileURL.path
        patientId = upload.patientId
        originalName = upload.originalName
        totalBytes = upload.totalBytes
        startedAt = upload.startedAt
    }

    var upload: PendingUpload {
        PendingUpload(
            id: id,
            fileURL: URL(fileURLWithPath: fileURL),
            patientId: patientId,
            originalName: originalName,
            totalBytes: totalBytes,
            startedAt: startedAt
        )
    }
}

// MARK: - The ports

/// The offline queue, on disk.
public struct SQLiteOutboxStore: OutboxStore {
    private let store: SQLiteStore

    public init(store: SQLiteStore) {
        self.store = store
    }

    public func pending() async throws -> [OutboxEntry] {
        // Oldest first: edits to one record must reach the server in the order
        // they were made, or a later correction is undone by an earlier one.
        try await store.read { database in
            try OutboxRow.order(Column("createdAt").asc).fetchAll(database)
        }
        .compactMap(\.entry)
    }

    public func append(_ entry: OutboxEntry) async throws {
        // Upsert rather than insert: a retry that re-queues the same edit must
        // not put two of it in the queue.
        try await store.write { try OutboxRow(entry).upsert($0) }
    }

    public func remove(id: String) async throws {
        _ = try await store.write { try OutboxRow.deleteOne($0, key: id) }
    }

    public func update(_ entry: OutboxEntry) async throws {
        try await store.write { database in
            // Only an entry that is still queued: updating the attempt count of
            // something already sent would resurrect it.
            if try OutboxRow.exists(database, key: entry.id) {
                try OutboxRow(entry).update(database)
            }
        }
    }

    public func conflicts() async throws -> [SyncConflict] {
        try await store.read { database in
            try ConflictRow.order(Column("detectedAt").asc).fetchAll(database)
        }
        .map(\.conflict)
    }

    public func recordConflict(_ conflict: SyncConflict) async throws {
        try await store.write { try ConflictRow(conflict).upsert($0) }
    }

    public func clearConflict(id: String) async throws {
        _ = try await store.write { try ConflictRow.deleteOne($0, key: id) }
    }
}

/// Unfinished uploads, on disk.
public struct SQLiteUploadStore: UploadStore {
    private let store: SQLiteStore

    public init(store: SQLiteStore) {
        self.store = store
    }

    public func unfinished() async throws -> [PendingUpload] {
        try await store.read { database in
            try UploadRow.order(Column("startedAt").asc).fetchAll(database)
        }
        .map(\.upload)
    }

    public func remember(_ upload: PendingUpload) async throws {
        try await store.write { try UploadRow(upload).upsert($0) }
    }

    public func forget(id: String) async throws {
        _ = try await store.write { try UploadRow.deleteOne($0, key: id) }
    }
}
