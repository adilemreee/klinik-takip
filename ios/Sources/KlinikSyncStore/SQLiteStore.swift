import Foundation
import GRDB
import KlinikAPI
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

        // The last successful answer to each read, so a device with no signal
        // shows what it last saw rather than an error (spec M15). Clinical
        // data, so it lives in the same protected store as the outbox and is
        // emptied on sign-out.
        migrator.registerMigration("v2-response-cache") { database in
            try database.create(table: "cachedResponse") { table in
                table.primaryKey("key", .text)
                table.column("body", .blob).notNull()
                table.column("storedAt", .datetime).notNull()
            }
        }

        /*
         * The queue holds requests now, not descriptions of changes.
         *
         * v1 stored an `operation` and a `payload` and left it to the sender to
         * work out what to do with them — which meant a switch over every kind
         * of write in the app, in the one layer that has no business knowing
         * about any of them. An entry now carries the request itself, so
         * replaying it is sending it again.
         *
         * The old table is dropped rather than migrated. No released build
         * ever wrote a row to it: nothing called `append` outside the tests
         * until this change, so there is no user's work to carry across. A
         * development build with rows in it loses them, which is said out loud
         * here rather than discovered later.
         */
        migrator.registerMigration("v3-outbox-holds-requests") { database in
            try database.drop(table: "outbox")
            try database.drop(table: "conflict")

            try database.create(table: "outbox") { table in
                table.primaryKey("id", .text)
                table.column("entityType", .text).notNull()
                table.column("entityId", .text).notNull()
                table.column("method", .text).notNull()
                table.column("path", .text).notNull()
                /// JSON. Writes rarely carry one, and nothing indexes it.
                table.column("query", .text).notNull()
                table.column("body", .blob)
                table.column("baseVersion", .integer)
                table.column("summary", .text).notNull()
                table.column("createdAt", .datetime).notNull()
                table.column("attempts", .integer).notNull().defaults(to: 0)
                table.column("lastError", .text)
            }

            // Sending is always "oldest first", so the order is an index rather
            // than a sort of the whole queue on every pass.
            try database.create(index: "outbox_createdAt", on: "outbox", columns: ["createdAt"])
            // Screens ask for their own kind, to show the user unsent work.
            try database.create(index: "outbox_entityType", on: "outbox", columns: ["entityType"])

            try database.create(table: "conflict") { table in
                table.primaryKey("id", .text)
                table.column("entityType", .text).notNull()
                table.column("entityId", .text).notNull()
                /// The user's whole request, so "keep mine" sends it again.
                table.column("local", .blob).notNull()
                table.column("serverRecord", .blob).notNull()
                table.column("serverVersion", .integer).notNull()
                table.column("detectedAt", .datetime).notNull()
            }
        }

        /*
         * An unfinished upload holds an intention, not a protocol state.
         *
         * v1 keyed the row on the server's session id, which meant a file
         * chosen with no connection at all could not be remembered: there was
         * no server to open a session with, so there was no id to file it
         * under. The row is now keyed locally and the session is a nullable
         * column acquired when there is something to talk to — and replaced if
         * it expires before the connection comes back.
         *
         * Dropped rather than migrated, for the same reason as v3: nothing
         * ever wrote a row here.
         */
        migrator.registerMigration("v4-uploads-survive-having-no-server") { database in
            try database.drop(table: "upload")

            try database.create(table: "upload") { table in
                table.primaryKey("id", .text)
                table.column("sessionId", .text)
                table.column("fileURL", .text).notNull()
                table.column("patientId", .text)
                table.column("documentType", .text).notNull()
                table.column("originalName", .text).notNull()
                table.column("contentType", .text).notNull()
                table.column("totalBytes", .integer).notNull()
                table.column("startedAt", .datetime).notNull()
                table.column("attempts", .integer).notNull().defaults(to: 0)
                table.column("lastError", .text)
            }

            try database.create(index: "upload_startedAt", on: "upload", columns: ["startedAt"])
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
    var method: String
    var path: String
    var query: String
    var body: Data?
    var baseVersion: Int?
    var summary: String
    var createdAt: Date
    var attempts: Int
    var lastError: String?

    init(_ entry: OutboxEntry) {
        let write = entry.write

        id = write.id
        entityType = write.entityType
        entityId = write.entityId
        method = write.method.rawValue
        path = write.path
        query = OutboxRow.encode(write.query)
        body = write.body
        baseVersion = write.ticket.baseVersion
        summary = write.summary
        createdAt = write.createdAt
        attempts = entry.attempts
        lastError = entry.lastError
    }

    /// Nil for a row whose method the app no longer recognises. A silently
    /// dropped edit is the one outcome this store exists to prevent, so it is
    /// reported by returning nothing rather than by guessing at a method.
    var entry: OutboxEntry? {
        guard let method = HTTPMethod(rawValue: method) else { return nil }

        return OutboxEntry(
            write: PendingWrite(
                ticket: QueuedWrite(
                    entityType: entityType,
                    entityId: entityId,
                    summary: summary,
                    baseVersion: baseVersion,
                    id: id
                ),
                method: method,
                path: path,
                query: OutboxRow.decode(query),
                body: body,
                createdAt: createdAt
            ),
            attempts: attempts,
            lastError: lastError
        )
    }

    private static func encode(_ query: [String: String]) -> String {
        guard !query.isEmpty, let data = try? JSONEncoder().encode(query) else { return "{}" }

        return String(decoding: data, as: UTF8.self)
    }

    private static func decode(_ query: String) -> [String: String] {
        (try? JSONDecoder().decode([String: String].self, from: Data(query.utf8))) ?? [:]
    }
}

private struct ConflictRow: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "conflict"

    var id: String
    var entityType: String
    var entityId: String
    var local: Data
    var serverRecord: Data
    var serverVersion: Int
    var detectedAt: Date

    init?(_ conflict: SyncConflict) {
        guard let encoded = try? JSONEncoder().encode(conflict.local) else { return nil }

        id = conflict.id
        entityType = conflict.entityType
        entityId = conflict.entityId
        local = encoded
        serverRecord = conflict.serverRecord
        serverVersion = conflict.serverVersion
        detectedAt = conflict.detectedAt
    }

    var conflict: SyncConflict? {
        guard let write = try? JSONDecoder().decode(PendingWrite.self, from: local) else {
            return nil
        }

        return SyncConflict(
            local: write,
            serverRecord: serverRecord,
            serverVersion: serverVersion,
            detectedAt: detectedAt
        )
    }
}

private struct UploadRow: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "upload"

    var id: String
    var sessionId: String?
    var fileURL: String
    var patientId: String?
    var documentType: String
    var originalName: String
    var contentType: String
    var totalBytes: Int
    var startedAt: Date
    var attempts: Int
    var lastError: String?

    init(_ upload: PendingUpload) {
        id = upload.id
        sessionId = upload.sessionId
        fileURL = upload.fileURL.path
        patientId = upload.patientId
        documentType = upload.documentType
        originalName = upload.originalName
        contentType = upload.contentType
        totalBytes = upload.totalBytes
        startedAt = upload.startedAt
        attempts = upload.attempts
        lastError = upload.lastError
    }

    var upload: PendingUpload {
        PendingUpload(
            id: id,
            sessionId: sessionId,
            fileURL: URL(fileURLWithPath: fileURL),
            patientId: patientId,
            documentType: documentType,
            originalName: originalName,
            contentType: contentType,
            totalBytes: totalBytes,
            startedAt: startedAt,
            attempts: attempts,
            lastError: lastError
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

    /// Filtered in SQL rather than in Swift, so a screen asking for its own
    /// kind does not read the whole queue to find three rows.
    public func pending(entityType: String) async throws -> [OutboxEntry] {
        try await store.read { database in
            try OutboxRow
                .filter(Column("entityType") == entityType)
                .order(Column("createdAt").asc)
                .fetchAll(database)
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
        .compactMap(\.conflict)
    }

    public func recordConflict(_ conflict: SyncConflict) async throws {
        guard let row = ConflictRow(conflict) else { return }

        try await store.write { try row.upsert($0) }
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

    /// Only a row that is still queued: updating one already finished would
    /// resurrect an upload the server has already assembled.
    public func update(_ upload: PendingUpload) async throws {
        try await store.write { database in
            if try UploadRow.exists(database, key: upload.id) {
                try UploadRow(upload).update(database)
            }
        }
    }

    public func forget(id: String) async throws {
        _ = try await store.write { try UploadRow.deleteOne($0, key: id) }
    }
}


// MARK: - Cached responses

private struct CachedResponseRow: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "cachedResponse"

    var key: String
    var body: Data
    var storedAt: Date
}

/**
 * The response cache, on disk.
 *
 * Entries older than the maximum age are neither served nor kept. A month-old
 * copy of somebody's medication plan is not "offline support"; it is a wrong
 * answer with a date on it, and the screen would present it in the same
 * sentence as a fresh one.
 */
public actor SQLiteResponseCache: ResponseCache {
    private let database: SQLiteStore
    private let maximumAge: TimeInterval

    /// A week: long enough to cover a flight and a hotel with no wifi, short
    /// enough that nothing clinical is shown from a previous admission.
    public init(store: SQLiteStore, maximumAge: TimeInterval = 7 * 24 * 60 * 60) {
        self.database = store
        self.maximumAge = maximumAge
    }

    public func store(_ body: Data, for key: String) async {
        // A cache is a convenience; a write that fails must not fail the read
        // that triggered it.
        try? await database.write { connection in
            try CachedResponseRow(key: key, body: body, storedAt: Date()).save(connection)
        }
    }

    public func load(for key: String) async -> CachedResponse? {
        let row = try? await database.read { connection in
            try CachedResponseRow.fetchOne(connection, key: key)
        }

        guard let found = row else { return nil }

        guard Date().timeIntervalSince(found.storedAt) <= maximumAge else {
            try? await database.write { connection in
                _ = try CachedResponseRow.deleteOne(connection, key: key)
            }

            return nil
        }

        return CachedResponse(body: found.body, storedAt: found.storedAt)
    }

    public func clear() async {
        try? await database.write { connection in
            _ = try CachedResponseRow.deleteAll(connection)
        }
    }
}
