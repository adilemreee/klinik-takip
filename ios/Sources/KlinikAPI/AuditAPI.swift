import Foundation
import KlinikCore

/// What was done. Mirrors the server's enum; the raw values are the wire form.
public enum AuditAction: String, Decodable, Sendable, Equatable, CaseIterable, Identifiable {
    case create = "CREATE"
    case read = "READ"
    case update = "UPDATE"
    case delete = "DELETE"
    case login = "LOGIN"
    case loginFailed = "LOGIN_FAILED"
    case logout = "LOGOUT"
    case export = "EXPORT"
    case permissionChange = "PERMISSION_CHANGE"
    case emergencyAccess = "EMERGENCY_ACCESS"

    public var id: String { rawValue }
    public var localizedName: String { L10n.string("audit.action.\(rawValue)") }

    /// The ones a reader scanning for trouble is scanning for.
    public var isNotable: Bool {
        self == .export || self == .delete || self == .permissionChange
            || self == .emergencyAccess || self == .loginFailed
    }
}

public struct AuditEntry: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    /// Null for anonymous events — a failed sign-in with an unknown identifier.
    public let actorId: String?
    public let actorRole: String?
    public let action: AuditAction
    public let entityType: String
    public let entityId: String?
    public let patientId: String?
    public let ipAddress: String?
    public let createdAt: Date

    public var localizedRole: String? {
        actorRole.map { L10n.name("role", $0) }
    }

    /// The table's own name, in the reader's language when it is one the app
    /// knows and verbatim when it is not — a log that hides an entity type it
    /// has no translation for is a log with a gap in it.
    public var localizedEntity: String {
        let key = "audit.entity.\(entityType)"
        let translated = L10n.string(key)

        return translated == key ? entityType : translated
    }
}

public struct AuditPage: Decodable, Sendable, Equatable {
    public let items: [AuditEntry]
    public let nextCursor: String?
}

/// A pattern the server thought worth pointing at (spec M13).
public struct AuditAnomaly: Decodable, Sendable, Equatable, Identifiable {
    public let kind: String
    public let actorId: String?
    public let actorRole: String?
    public let count: Int
    public let windowStart: Date
    public let windowEnd: Date
    /// The server's own sentence. Rendered rather than re-worded: it knows what
    /// it counted and the client does not.
    public let detail: String

    public var id: String { "\(kind)-\(actorId ?? "anon")-\(windowStart.timeIntervalSince1970)" }

    public var localizedKind: String { L10n.name("audit.anomaly", kind) }
}

public struct AuditFilter: Sendable, Equatable {
    public var action: AuditAction?
    public var patientId: String?
    public var entityType: String?
    public var from: Date?
    public var cursor: String?

    public init(
        action: AuditAction? = nil,
        patientId: String? = nil,
        entityType: String? = nil,
        from: Date? = nil,
        cursor: String? = nil
    ) {
        self.action = action
        self.patientId = patientId
        self.entityType = entityType
        self.from = from
        self.cursor = cursor
    }

    var queryItems: [String: String] {
        var items: [String: String] = [:]
        let formatter = ISO8601DateFormatter()

        if let action { items["action"] = action.rawValue }
        if let patientId { items["patientId"] = patientId }
        if let entityType { items["entityType"] = entityType }
        if let from { items["from"] = formatter.string(from: from) }
        if let cursor { items["cursor"] = cursor }

        return items
    }
}

/**
 * The audit trail (spec M13).
 *
 * Reading it is itself recorded, which is the point: a log somebody can read
 * without leaving a trace is a log that protects nobody.
 */
public struct AuditAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func entries(_ filter: AuditFilter = AuditFilter()) async throws -> AuditPage {
        try await client.send(
            Endpoint(method: .get, path: "audit", query: filter.queryItems),
            as: AuditPage.self
        )
    }

    public func anomalies(hours: Int = 24) async throws -> [AuditAnomaly] {
        try await client.send(
            Endpoint(method: .get, path: "audit/anomalies", query: ["hours": String(hours)]),
            as: [AuditAnomaly].self
        )
    }
}
