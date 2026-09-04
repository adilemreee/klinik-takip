import Foundation

/// A change made locally that has not reached the server yet.
public struct OutboxEntry: Sendable, Equatable, Identifiable, Codable {
    public enum Operation: String, Sendable, Codable {
        case update
        case create
    }

    public let id: String
    public let entityType: String
    public let entityId: String
    public let operation: Operation
    /// The request body, already encoded.
    public let payload: Data
    /// The version the record had when the user started editing. Sent back so
    /// the server can tell whether anyone changed it in the meantime.
    public let baseVersion: Int?
    public let createdAt: Date
    public var attempts: Int
    public var lastError: String?

    public init(
        id: String = UUID().uuidString,
        entityType: String,
        entityId: String,
        operation: Operation = .update,
        payload: Data,
        baseVersion: Int?,
        createdAt: Date = Date(),
        attempts: Int = 0,
        lastError: String? = nil
    ) {
        self.id = id
        self.entityType = entityType
        self.entityId = entityId
        self.operation = operation
        self.payload = payload
        self.baseVersion = baseVersion
        self.createdAt = createdAt
        self.attempts = attempts
        self.lastError = lastError
    }
}

/// A change the server refused because someone else edited the record first.
///
/// Kept rather than discarded: spec M15 says clinical data is never silently
/// overwritten, which also means the user's work is never silently thrown away.
public struct SyncConflict: Sendable, Equatable, Identifiable, Codable {
    public let id: String
    public let entityType: String
    public let entityId: String
    /// What the user wrote.
    public let localPayload: Data
    /// What the server has now, for the screen to show alongside it.
    public let serverRecord: Data
    public let serverVersion: Int
    public let detectedAt: Date

    public init(
        id: String,
        entityType: String,
        entityId: String,
        localPayload: Data,
        serverRecord: Data,
        serverVersion: Int,
        detectedAt: Date = Date()
    ) {
        self.id = id
        self.entityType = entityType
        self.entityId = entityId
        self.localPayload = localPayload
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
