import Foundation
import KlinikAPI

/// A change made locally that has not reached the server yet.
///
/// The request itself, plus what the queue has learnt about trying to send it.
/// Storing the request rather than a description of the change is what keeps
/// this layer free of a switch over every kind of write in the app: replaying
/// an entry is sending it again, not reconstructing it.
public struct OutboxEntry: Sendable, Equatable, Identifiable, Codable {
    public let write: PendingWrite
    public var attempts: Int
    public var lastError: String?

    public var id: String { write.id }
    public var entityType: String { write.entityType }
    public var entityId: String { write.entityId }
    public var createdAt: Date { write.createdAt }
    /// The line the user reads in the pending list.
    public var summary: String { write.summary }

    /// Writes to one record are sent in the order they were made, so this is
    /// what groups them.
    public var recordKey: String { "\(entityType):\(entityId)" }

    public init(write: PendingWrite, attempts: Int = 0, lastError: String? = nil) {
        self.write = write
        self.attempts = attempts
        self.lastError = lastError
    }
}

/// A change the server refused because someone else edited the record first.
///
/// Kept rather than discarded: spec M15 says clinical data is never silently
/// overwritten, which also means the user's work is never silently thrown away.
public struct SyncConflict: Sendable, Equatable, Identifiable, Codable {
    /// What the user wrote, whole — so "keep mine" is sending it again rather
    /// than rebuilding a request from a description of one.
    public let local: PendingWrite
    /// What the server has now, for the screen to show alongside it.
    public let serverRecord: Data
    public let serverVersion: Int
    public let detectedAt: Date

    public var id: String { local.id }
    public var entityType: String { local.entityType }
    public var entityId: String { local.entityId }
    public var summary: String { local.summary }

    public init(
        local: PendingWrite,
        serverRecord: Data,
        serverVersion: Int,
        detectedAt: Date = Date()
    ) {
        self.local = local
        self.serverRecord = serverRecord
        self.serverVersion = serverVersion
        self.detectedAt = detectedAt
    }
}

/// Where the queue lives between launches.
///
/// A port so the sync logic is testable without a database, and so the
/// SQLite-backed implementation is a detail rather than a dependency.
public protocol OutboxStore: Sendable {
    func pending() async throws -> [OutboxEntry]
    func append(_ entry: OutboxEntry) async throws
    func remove(id: String) async throws
    func update(_ entry: OutboxEntry) async throws

    func conflicts() async throws -> [SyncConflict]
    func recordConflict(_ conflict: SyncConflict) async throws
    func clearConflict(id: String) async throws
}

public extension OutboxStore {
    /**
     * The queued writes of one kind.
     *
     * What a screen needs to show the user their own work. Nothing in this app
     * keeps a local copy of the clinic's records, so a reading entered on a
     * plane exists in exactly one place until it is sent — and a list that
     * showed only what the server knows would look, to the person who typed
     * it, like the app had thrown it away.
     */
    func pending(entityType: String) async throws -> [OutboxEntry] {
        try await pending().filter { $0.entityType == entityType }
    }
}

/// In-memory store for tests and previews.
public actor InMemoryOutboxStore: OutboxStore {
    private var entries: [OutboxEntry] = []
    private var storedConflicts: [SyncConflict] = []

    public init() {}

    public func pending() async throws -> [OutboxEntry] {
        // Oldest first: edits to one record must reach the server in the order
        // they were made, or a later correction can be undone by an earlier one.
        entries.sorted { $0.createdAt < $1.createdAt }
    }

    public func append(_ entry: OutboxEntry) async throws {
        entries.append(entry)
    }

    public func remove(id: String) async throws {
        entries.removeAll { $0.id == id }
    }

    public func update(_ entry: OutboxEntry) async throws {
        guard let index = entries.firstIndex(where: { $0.id == entry.id }) else { return }
        entries[index] = entry
    }

    public func conflicts() async throws -> [SyncConflict] { storedConflicts }

    public func recordConflict(_ conflict: SyncConflict) async throws {
        storedConflicts.append(conflict)
    }

    public func clearConflict(id: String) async throws {
        storedConflicts.removeAll { $0.id == id }
    }
}

/// A file whose upload was started and has not finished.
///
/// Uploading is resumable against the server — it reports how many bytes it
/// already has — but only if the app still knows which session belonged to
/// which file. Held in memory, that mapping dies with the process, and a
/// patient who was uploading a 20 MB scan when the phone killed the app starts
/// again from nothing on a connection that was already struggling.
public struct PendingUpload: Sendable, Equatable, Identifiable, Codable {
    /// The server's upload session.
    public let id: String
    /// Where the file is on this device.
    public let fileURL: URL
    public let patientId: String?
    public let originalName: String
    public let totalBytes: Int
    public let startedAt: Date

    public init(
        id: String,
        fileURL: URL,
        patientId: String? = nil,
        originalName: String,
        totalBytes: Int,
        startedAt: Date = Date()
    ) {
        self.id = id
        self.fileURL = fileURL
        self.patientId = patientId
        self.originalName = originalName
        self.totalBytes = totalBytes
        self.startedAt = startedAt
    }
}

/// Where unfinished uploads are remembered between launches.
public protocol UploadStore: Sendable {
    func unfinished() async throws -> [PendingUpload]
    func remember(_ upload: PendingUpload) async throws
    func forget(id: String) async throws
}

/// In-memory store for tests and previews.
public actor InMemoryUploadStore: UploadStore {
    private var uploads: [PendingUpload] = []

    public init() {}

    public func unfinished() async throws -> [PendingUpload] {
        uploads.sorted { $0.startedAt < $1.startedAt }
    }

    public func remember(_ upload: PendingUpload) async throws {
        uploads.removeAll { $0.id == upload.id }
        uploads.append(upload)
    }

    public func forget(id: String) async throws {
        uploads.removeAll { $0.id == id }
    }
}
