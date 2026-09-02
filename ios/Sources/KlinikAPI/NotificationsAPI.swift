import Foundation
import KlinikCore

public enum NotificationChannel: String, Decodable, Encodable, Sendable, CaseIterable {
    case push = "PUSH"
    case sms = "SMS"
    case email = "EMAIL"
    case whatsapp = "WHATSAPP"
    case inApp = "IN_APP"

    public var localizedName: String { L10n.string("notification.channel.\(rawValue)") }
}

public enum NotificationDeliveryStatus: String, Decodable, Sendable, Equatable {
    case pending = "PENDING"
    case sent = "SENT"
    case delivered = "DELIVERED"
    case read = "READ"
    case failed = "FAILED"

    public var localizedName: String { L10n.string("notification.status.\(rawValue)") }
}

/// The notification types a person can turn on or off, mirroring the server.
public enum NotificationKind: String, Decodable, Encodable, Sendable, CaseIterable {
    case labReady = "lab.ready"
    case labCritical = "lab.critical"
    case newMessage = "message.new"
    case medicationDue = "medication.due"
    case appointmentReminder = "appointment.reminder"
    case documentMissing = "document.missing"
    case complicationAnswered = "complication.answered"

    public var localizedName: String { L10n.string("notification.type.\(rawValue)") }
}

public struct NotificationPreference: Decodable, Sendable, Equatable, Identifiable {
    public let type: String
    public let channel: NotificationChannel
    public let enabled: Bool
    public let quietHoursStart: String?
    public let quietHoursEnd: String?
    public let timezone: String

    public var id: String { "\(type)|\(channel.rawValue)" }
}

public struct DeliveredNotification: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let type: String
    public let title: String
    public let body: String
    public let channel: NotificationChannel
    public let status: NotificationDeliveryStatus
    /// Why this attempt did not arrive.
    public let failureReason: String?
    /// The attempt this one is standing in for.
    public let fallbackForId: String?
    public let sentAt: Date?
    public let readAt: Date?
    public let createdAt: Date

    public var isFallback: Bool { fallbackForId != nil }
}

public struct NotificationsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Registers this device. Called after the system grants permission, and
    /// again whenever the platform hands out a new token.
    public func registerToken(_ token: String, platform: String, deviceId: String?) async throws {
        try await client.send(
            Endpoint(
                method: .post,
                path: "me/notifications/tokens",
                body: try JSONEncoder.klinik.encode(
                    TokenBody(token: token, platform: platform, deviceId: deviceId)
                )
            )
        )
    }

    /// Called on sign-out, so a device stops receiving what it may no longer see.
    public func revokeToken(_ token: String) async throws {
        try await client.send(
            Endpoint(method: .delete, path: "me/notifications/tokens", query: ["token": token])
        )
    }

    public func preferences() async throws -> [NotificationPreference] {
        try await client.send(
            Endpoint(method: .get, path: "me/notifications/preferences"),
            as: [NotificationPreference].self
        )
    }

    @discardableResult
    public func setPreference(
        type: NotificationKind,
        channel: NotificationChannel,
        enabled: Bool,
        quietHoursStart: String? = nil,
        quietHoursEnd: String? = nil
    ) async throws -> NotificationPreference {
        try await client.send(
            Endpoint(
                method: .put,
                path: "me/notifications/preferences",
                body: try JSONEncoder.klinik.encode(
                    PreferenceBody(
                        type: type.rawValue,
                        channel: channel,
                        enabled: enabled,
                        quietHoursStart: quietHoursStart,
                        quietHoursEnd: quietHoursEnd
                    )
                )
            ),
            as: NotificationPreference.self
        )
    }

    public func history() async throws -> [DeliveredNotification] {
        try await client.send(
            Endpoint(method: .get, path: "me/notifications"),
            as: [DeliveredNotification].self
        )
    }

    @discardableResult
    public func markRead() async throws -> Int {
        let result = try await client.send(
            Endpoint(method: .post, path: "me/notifications/read"),
            as: MarkedRead.self
        )

        return result.marked
    }

    private struct TokenBody: Encodable {
        let token: String
        let platform: String
        let deviceId: String?
    }

    private struct PreferenceBody: Encodable {
        let type: String
        let channel: NotificationChannel
        let enabled: Bool
        let quietHoursStart: String?
        let quietHoursEnd: String?
    }

    private struct MarkedRead: Decodable, Sendable {
        let marked: Int
    }
}
