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
    /// What the clinic acted on: the higher of the keyword screen and the AI.
    public let triageLevel: TriageLevel?
    /// Ids of the red flags that fired, never the phrases they matched.
    public let triageFlags: [String]
    /// The AI's own reading. It can raise `triageLevel`, never lower it.
    public let aiTriageLevel: TriageLevel?
    /// Three lines for the clinician. Rendered beside the message, never instead of it.
    public let aiSummary: String?
    /// The language the sender wrote in, as the model read it. Nil until
    /// somebody asks for a translation.
    public let originalLanguage: String?
    /// A translation somebody asked for (spec M3). Shown beside the original,
    /// never instead of it: what the patient actually wrote is the record.
    public let translatedText: String?
    public let translatedTo: String?
    public let createdAt: Date

    public var isQueued: Bool { status == .queued }

    /// Whether there is anything to translate. An attachment with no words is
    /// not a message a model can do anything with.
    public var hasText: Bool {
        !((body ?? transcript ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
    public var hasAttachment: Bool { type == .file || type == .image || type == .audio }

    /// Whether this message should be marked out in a clinician's list.
    public var needsAttention: Bool { triageLevel == .urgent || triageLevel == .emergency }

    /**
     * Decoded leniently for the three translation fields.
     *
     * A message written before translation existed carries none of them, and
     * refusing to decode it would empty the thread of everything the clinic
     * already has.
     */
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(String.self, forKey: .id)
        conversationId = try container.decode(String.self, forKey: .conversationId)
        senderId = try container.decodeIfPresent(String.self, forKey: .senderId)
        type = try container.decode(MessageType.self, forKey: .type)
        body = try container.decodeIfPresent(String.self, forKey: .body)
        transcript = try container.decodeIfPresent(String.self, forKey: .transcript)
        status = try container.decode(MessageStatus.self, forKey: .status)
        queuedUntil = try container.decodeIfPresent(Date.self, forKey: .queuedUntil)
        readAt = try container.decodeIfPresent(Date.self, forKey: .readAt)
        triageLevel = try container.decodeIfPresent(TriageLevel.self, forKey: .triageLevel)
        triageFlags = try container.decodeIfPresent([String].self, forKey: .triageFlags) ?? []
        aiTriageLevel = try container.decodeIfPresent(TriageLevel.self, forKey: .aiTriageLevel)
        aiSummary = try container.decodeIfPresent(String.self, forKey: .aiSummary)
        originalLanguage = try container.decodeIfPresent(String.self, forKey: .originalLanguage)
        translatedText = try container.decodeIfPresent(String.self, forKey: .translatedText)
        translatedTo = try container.decodeIfPresent(String.self, forKey: .translatedTo)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
    }

    private enum CodingKeys: String, CodingKey {
        case id, conversationId, senderId, type, body, transcript, status, queuedUntil, readAt
        case triageLevel, triageFlags, aiTriageLevel, aiSummary
        case originalLanguage, translatedText, translatedTo, createdAt
    }
}

public enum TriageLevel: String, Decodable, Sendable, Equatable {
    case info = "INFO"
    case routine = "ROUTINE"
    case urgent = "URGENT"
    case emergency = "EMERGENCY"

    public var localizedName: String { L10n.string("triage.level.\(rawValue)") }
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

/// One row of the clinician's inbox (spec M3).
///
/// Carries the name, the last thing said and the unread count, because an
/// inbox of ids and timestamps is a list somebody has to open every row of.
public struct InboxEntry: Decodable, Sendable, Equatable, Identifiable {
    public let conversation: Conversation
    public let patient: InboxPatient
    public let lastMessage: InboxLastMessage?
    /// Approximate by design — enough to decide whether to open the row.
    public let unread: Int

    public var id: String { conversation.id }

    public struct InboxPatient: Decodable, Sendable, Equatable {
        public let id: String
        public let mrn: String
        public let fullName: String
    }

    public struct InboxLastMessage: Decodable, Sendable, Equatable {
        /// Null for an attachment with no text.
        public let body: String?
        public let sentAt: Date
        public let type: MessageType
    }

    /// What the row shows under the name.
    public var preview: String {
        guard let lastMessage else { return "" }

        if let body = lastMessage.body, !body.isEmpty { return body }

        return L10n.string(
            lastMessage.type == .image ? "message.photoAttached" : "message.fileAttached"
        )
    }
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

    public func inbox() async throws -> [InboxEntry] {
        try await client.send(Endpoint(method: .get, path: "conversations"), as: [InboxEntry].self)
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

    /**
     * Sends a message.
     *
     * Queued when there is no connection (spec M15), filed under the
     * conversation: messages in one thread must reach the clinic in the order
     * they were written, and a refused one holds the rest rather than letting
     * an answer arrive before its question.
     */
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
                ),
                offline: .queue(
                    QueuedWrite(
                        entityType: MessagingAPI.queuedEntity,
                        entityId: conversationId,
                        summary: String(
                            format: L10n.string("sync.item.message"),
                            MessagingAPI.preview(of: body)
                        )
                    )
                )
            ),
            as: SentMessage.self
        )
    }

    /// What a queued message is filed under.
    public static let queuedEntity = "message"

    /**
     * Translates a message into a language (spec M3).
     *
     * The answer carries the original as well: a translation is a reading of
     * what somebody wrote, and the screen shows both.
     */
    public func translate(messageId: String, to language: String) async throws -> ChatMessage {
        try await client.send(
            Endpoint(
                method: .post,
                path: "conversations/messages/\(messageId)/translate",
                body: try JSONEncoder.klinik.encode(TranslateBody(to: language))
            ),
            as: ChatMessage.self
        )
    }

    /// What the patient wrote, read back out of a queued message.
    public static func queuedText(in write: PendingWrite) -> String? {
        guard
            let body = write.body,
            let decoded = try? JSONDecoder.klinik.decode(SendBody.self, from: body)
        else {
            return nil
        }

        return decoded.body
    }

    /// Enough of the message to recognise it in the pending list, without
    /// putting a paragraph of somebody's medical history in a row.
    static func preview(of body: String?) -> String {
        let text = (body ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        guard text.count > 40 else { return text }

        return text.prefix(40).trimmingCharacters(in: .whitespaces) + "…"
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

    /// Codable, not just Encodable: a message queued while offline is read
    /// back out so it can be shown in the thread that it belongs to.
    private struct SendBody: Codable {
        let body: String?
        let mediaKey: String?
        let type: MessageType?
    }

    private struct TranslateBody: Encodable {
        let to: String
    }

    private struct MarkedRead: Decodable, Sendable {
        let marked: Int
    }

    private struct AttachmentLink: Decodable, Sendable {
        let url: String
    }
}
