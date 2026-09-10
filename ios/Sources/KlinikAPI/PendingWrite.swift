import Foundation
import KlinikCore

/**
 * The bookkeeping a write needs before it can be kept for later.
 *
 * Attached to the endpoint by whichever API method is willing to be queued —
 * which is a clinical decision, not a technical one, and so is made one method
 * at a time rather than by a rule over all writes. An alarm must not sit in a
 * queue; a weight recorded in a hotel with no wifi must not be lost.
 */
public struct QueuedWrite: Sendable, Equatable, Codable {
    /**
     * Generated once, on the first attempt, and kept for every attempt after.
     *
     * It travels as `Idempotency-Key`, which is what makes replay safe. The
     * dangerous case is not the request that never arrived — it is the one
     * that arrived, committed, and lost its answer on the way back: the phone
     * cannot tell those apart, and without the key the retry would record a
     * second dose, a second complaint, a second message.
     */
    public let id: String

    /// Groups writes that touch the same record. A conflict on one holds back
    /// the later edits to that record, which were written against a picture
    /// the user has not seen change.
    public let entityType: String
    public let entityId: String

    /// The version the record carried when the user started editing, for the
    /// endpoints that have one. Nil for anything being created.
    public let baseVersion: Int?

    /// One line naming the change, in the user's language.
    ///
    /// Carried rather than derived, because by the time the queue is being
    /// shown, the only thing that still knows a POST to `me/measurements` was
    /// "Ölçüm: Kilo" is whoever built it.
    public let summary: String

    public init(
        entityType: String,
        entityId: String,
        summary: String,
        baseVersion: Int? = nil,
        id: String = UUID().uuidString
    ) {
        self.id = id
        self.entityType = entityType
        self.entityId = entityId
        self.baseVersion = baseVersion
        self.summary = summary
    }

    /**
     * A write that stands alone.
     *
     * Most of what a patient records is an addition, not an edit: a reading, a
     * complaint, a message. Nothing else in the queue is a change to the same
     * record, so each is its own record — which matters, because the engine
     * holds back later writes to a record whose earlier write was refused, and
     * one rejected reading must not stop tomorrow's from being sent.
     */
    public static func standalone(entityType: String, summary: String) -> QueuedWrite {
        let id = UUID().uuidString

        return QueuedWrite(entityType: entityType, entityId: id, summary: summary, id: id)
    }
}

/// What the client does with a write it could not deliver.
public enum OfflineBehaviour: Sendable, Equatable {
    /// Fail, like any other request. The default, and right for everything
    /// whose whole value is that it happened now.
    case fail

    /// Keep it and send it when the connection returns.
    case queue(QueuedWrite)

    /// This attempt *is* the queue sending it. Carries the same key so the
    /// server recognises an attempt that already got through, and does not
    /// queue a second copy of something already queued.
    case replaying(QueuedWrite)

    /// The key this attempt travels under, if any.
    public var ticket: QueuedWrite? {
        switch self {
        case .fail: return nil
        case .queue(let ticket), .replaying(let ticket): return ticket
        }
    }

    var isQueueable: Bool {
        if case .queue = self { return true }
        return false
    }
}

/**
 * A write the app accepted from the user and has not delivered.
 *
 * Everything needed to send it again later, which is the request itself plus
 * the ticket. Codable because it outlives the process: a queue held in memory
 * dies exactly when the phone reclaims the app, which is the same afternoon
 * the connection was bad enough to fill it.
 */
public struct PendingWrite: Sendable, Equatable, Identifiable, Codable {
    public let ticket: QueuedWrite
    public let method: HTTPMethod
    public let path: String
    public let query: [String: String]
    public let body: Data?
    public let createdAt: Date

    public var id: String { ticket.id }
    public var entityType: String { ticket.entityType }
    public var entityId: String { ticket.entityId }
    public var summary: String { ticket.summary }

    public init(
        ticket: QueuedWrite,
        method: HTTPMethod,
        path: String,
        query: [String: String] = [:],
        body: Data?,
        createdAt: Date = Date()
    ) {
        self.ticket = ticket
        self.method = method
        self.path = path
        self.query = query
        self.body = body
        self.createdAt = createdAt
    }

    /// From an endpoint that declared itself queueable. Returns nil for one
    /// that did not, so a write can never be queued by accident.
    public init?(_ endpoint: Endpoint, createdAt: Date = Date()) {
        guard case .queue(let ticket) = endpoint.offline else { return nil }

        self.init(
            ticket: ticket,
            method: endpoint.method,
            path: endpoint.path,
            query: endpoint.query,
            body: endpoint.body,
            createdAt: createdAt
        )
    }

    /// The request, rebuilt for another attempt.
    ///
    /// `.replaying` rather than `.queue`: a replay that meets the same dead
    /// connection must leave the entry where it is, not add a copy of it.
    public var replayEndpoint: Endpoint {
        Endpoint(
            method: method,
            path: path,
            query: query,
            body: body,
            offline: .replaying(ticket)
        )
    }
}

/**
 * Where a write waits.
 *
 * Declared here, and satisfied in `KlinikSync`, so the client can hand a write
 * to the queue without the networking layer knowing a database exists.
 */
public protocol PendingWriteQueue: Sendable {
    func enqueue(_ write: PendingWrite) async throws
}

/**
 * The queue, seen by a screen.
 *
 * Nothing in this app keeps a local copy of the clinic's records, so a reading
 * typed on a plane exists in exactly one place until it is sent. A list drawn
 * only from what the server knows would look, to the person who typed it, like
 * the app had thrown it away — so screens read their own unsent work back out
 * and show it, marked as unsent.
 */
public protocol PendingWriteReader: Sendable {
    func unsent(entityType: String) async -> [PendingWrite]
}

/**
 * Where a file goes when it cannot be sent now.
 *
 * Separate from `PendingWriteQueue` because bytes are a different problem from
 * requests: a queued reading is four hundred characters that can be replayed
 * in one call, and a queued scan is twenty megabytes that has to survive the
 * app being killed and resume from wherever the server got to.
 */
public protocol PendingUploadQueue: Sendable {
    /**
     * Takes custody of a file, copying it somewhere the app owns.
     *
     * `sessionId` is the server session already opened for it, when there is
     * one. Passing it is what lets a transfer interrupted at 18 MB carry on
     * from 18 MB rather than start again — which, on the hotel connection this
     * product has to survive, is the whole difference.
     */
    func keep(
        fileURL: URL,
        subject: RecordSubject,
        type: DocumentType,
        contentType: String,
        originalName: String?,
        sessionId: String?
    ) async throws
}

/// What happened when the queue sent one write again.
public enum ReplayResult: Sendable, Equatable {
    case succeeded
    /// The failure, and the body it came with. The body is empty when the
    /// request never reached a server to produce one.
    case failed(APIError, body: Data)
}
