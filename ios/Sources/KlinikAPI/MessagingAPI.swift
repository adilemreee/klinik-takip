import Foundation
import KlinikCore

public enum MessageType: String, Decodable, Encodable, Sendable {
    case text = "TEXT"
    case image = "IMAGE"
    case file = "FILE"
    case audio = "AUDIO"
    case system = "SYSTEM"
    case bot = "BOT"
}

public enum MessageStatus: String, Decodable, Sendable, Equatable {
    /// Written outside the clinic's access window; released when it opens.
    case queued = "QUEUED"
    case sent = "SENT"
    case delivered = "DELIVERED"
    case read = "READ"
    case failed = "FAILED"

    public var localizedName: String { L10n.string("message.status.\(rawValue)") }
}

public struct ChatMessage: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let conversationId: String
    /// Null for clinic or system messages.
    public let senderId: String?
    public let type: MessageType
    public let body: String?
    /// Filled by the AI layer once audio is transcribed (Faz 5).
    public let transcript: String?
    public let status: MessageStatus
    /// When a held message will be delivered.
    public let queuedUntil: Date?
    public let readAt: Date?
    public let createdAt: Date

    public var isQueued: Bool { status == .queued }
    public var hasAttachment: Bool { type == .file || type == .image || type == .audio }
}

public struct MessagePage: Decodable, Sendable {
    /// Oldest first, ready to render.
    public let items: [ChatMessage]
    /// Pass back to load older messages.
    public let nextCursor: String?
}

public struct SentMessage: Decodable, Sendable {
    public let message: ChatMessage
    /// Set when the message was held until the clinic opens.
    public let queuedUntil: Date?
}

public struct ClinicState: Decodable, Sendable, Equatable {
    public let open: Bool
    public let opensAt: Date?
}

public struct Conversation: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let patientId: String
    public let subject: String?
    public let lastMessageAt: Date?
}

public struct Attachment: Decodable, Sendable {
    /// Send this with the message.
    public let mediaKey: String
    public let mime: String
    public let size: Int
}

public struct QuickReply: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    /// Null for a reply the whole clinic shares.
    public let staffId: String?
    public let title: String
    public let body: String
    public let sortOrder: Int
}

public struct MessagingAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Asked before the patient writes, so the compose box can say "queued
    /// until 18:00" rather than surprising them after they have sent something.
    public func clinicState() async throws -> ClinicState {
        try await client.send(
            Endpoint(method: .get, path: "conversations/clinic-state"),
            as: ClinicState.self
        )
    }

    public func myConversation() async throws -> Conversation {
        try await client.send(Endpoint(method: .get, path: "me/conversation"), as: Conversation.self)
    }

    public func conversation(patientId: String) async throws -> Conversation {
        try await client.send(
            Endpoint(method: .get, path: "patients/\(patientId)/conversation"),
            as: Conversation.self
        )
    }

    public func inbox() async throws -> [Conversation] {
        try await client.send(Endpoint(method: .get, path: "conversations"), as: [Conversation].self)
    }

    public func messages(
        conversationId: String,
        cursor: String? = nil,
        limit: Int? = nil
    ) async throws -> MessagePage {
        var query: [String: String] = [:]
        if let cursor { query["cursor"] = cursor }
        if let limit { query["limit"] = String(limit) }

        return try await client.send(
            Endpoint(method: .get, path: "conversations/\(conversationId)/messages", query: query),
            as: MessagePage.self
        )
    }

    public func send(
        conversationId: String,
        body: String?,
        mediaKey: String? = nil,
        type: MessageType? = nil
    ) async throws -> SentMessage {
        try await client.send(
            Endpoint(
                method: .post,
                path: "conversations/\(conversationId)/messages",
                body: try JSONEncoder.klinik.encode(
                    SendBody(body: body, mediaKey: mediaKey, type: type)
                )
            ),
            as: SentMessage.self
        )
    }

    public func attach(conversationId: String, fileURL: URL, contentType: String) async throws -> Attachment {
        try await client.upload(
            Endpoint(method: .post, path: "conversations/\(conversationId)/attachments"),
            multipart: MultipartBody(fileURL: fileURL, contentType: contentType),
            as: Attachment.self
        )
    }

    @discardableResult
    public func markRead(conversationId: String) async throws -> Int {
        let result = try await client.send(
            Endpoint(method: .post, path: "conversations/\(conversationId)/read"),
            as: MarkedRead.self
        )

        return result.marked
    }

    public func attachmentURL(messageId: String) async throws -> URL? {
        let link = try await client.send(
            Endpoint(method: .get, path: "conversations/messages/\(messageId)/attachment"),
            as: AttachmentLink.self
        )

        return URL(string: link.url)
    }

    public func quickReplies() async throws -> [QuickReply] {
        try await client.send(Endpoint(method: .get, path: "quick-replies"), as: [QuickReply].self)
    }

    private struct SendBody: Encodable {
        let body: String?
        let mediaKey: String?
        let type: MessageType?
    }

    private struct MarkedRead: Decodable, Sendable {
        let marked: Int
    }

    private struct AttachmentLink: Decodable, Sendable {
        let url: String
    }
}
