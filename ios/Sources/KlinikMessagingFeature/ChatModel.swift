import Foundation
import KlinikAPI
import KlinikCore

public enum ChatPhase: Sendable, Equatable {
    case loading
    case loaded
    /// No messages yet. Not a failure.
    case empty
    case notFound
    case failed(String)
}

public struct ChatState: Sendable, Equatable {
    public var phase: ChatPhase = .loading
    public var conversationId: String?
    /// Oldest first, ready to render.
    public var messages: [ChatMessage] = []
    public var olderCursor: String?
    /// Whether the clinic is reachable, and when it next will be.
    public var clinic: ClinicState?
    public var quickReplies: [QuickReply] = []
    public var sending = false
    public var error: String?
    /// An uploaded file waiting for its message. Kept so a failed send can be
    /// retried without transferring the bytes a second time.
    public var pendingMediaKey: String?
    public var pendingMediaType: MessageType?
    /// Who is typing, other than the caller.
    public var typing: Set<String> = []

    public var hasOlder: Bool { olderCursor != nil }

    /// True when what the patient writes now will be held rather than sent.
    public var willBeQueued: Bool { clinic?.open == false }

    public init() {}
}

/// One conversation (spec M3).
///
/// Messages are sent over REST and *announced* over the socket. A socket that
/// drops mid-send would leave the client unsure whether the message exists; a
/// POST either returns an id or does not.
public actor ChatModel {
    private let api: MessagingAPI
    private let conversation: () async throws -> Conversation

    private(set) public var state = ChatState()

    public init(api: MessagingAPI, conversation: @escaping @Sendable () async throws -> Conversation) {
        self.api = api
        self.conversation = conversation
    }

    public func currentState() -> ChatState { state }

    public func load() async {
        state.phase = .loading

        do {
            let conversation = try await self.conversation()
            state.conversationId = conversation.id

            // Asked together: the compose box has to know whether the clinic is
            // open before the patient starts writing, not after they send.
            async let page = api.messages(conversationId: conversation.id)
            async let clinic = api.clinicState()

            let loaded = try await page
            state.messages = loaded.items
            state.olderCursor = loaded.nextCursor
            state.clinic = try await clinic
            state.phase = loaded.items.isEmpty ? .empty : .loaded
        } catch let error as APIError {
            if case .notFound = error {
                state.phase = .notFound
            } else {
                state.phase = .failed(L10n.message(for: error))
            }
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    /// Older messages, prepended. The cursor walks backwards through history.
    public func loadOlder() async {
        guard let conversationId = state.conversationId, let cursor = state.olderCursor else {
            return
        }

        do {
            let page = try await api.messages(conversationId: conversationId, cursor: cursor)
            state.messages = page.items + state.messages
            state.olderCursor = page.nextCursor
        } catch {
            // A failed page is not worth interrupting the conversation for; what
            // is on screen is still correct.
        }
    }

    @discardableResult
    public func send(_ body: String, mediaKey: String? = nil) async -> Bool {
        guard let conversationId = state.conversationId, !state.sending else { return false }

        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || mediaKey != nil else { return false }

        state.sending = true
        state.error = nil
        defer { state.sending = false }

        do {
            let sent = try await api.send(
                conversationId: conversationId,
                body: trimmed.isEmpty ? nil : trimmed,
                mediaKey: mediaKey,
                type: messageType
            )

            // Appended from the server's answer, including its queued status, so
            // the row on screen says the same thing the clinic will see.
            append(sent.message)
            state.pendingMediaKey = nil
            state.pendingMediaType = nil
        } catch let error as APIError {
            state.error = L10n.message(for: error)
            return false
        } catch {
            state.error = L10n.string("error.server")
            return false
        }

        return true
    }

    /**
     * Attaches a file and sends it as one message.
     *
     * Two calls, and the second one is the point: an upload that succeeds and a
     * send that fails leaves a file in storage nobody can see. The key is kept
     * so the send can be retried without uploading the bytes again — on hotel
     * wifi that difference is a wound photograph transferred twice.
     */
    @discardableResult
    public func attach(fileURL: URL, contentType: String, caption: String = "") async -> Bool {
        guard let conversationId = state.conversationId, !state.sending else { return false }

        state.sending = true
        state.error = nil

        do {
            let attachment = try await api.attach(
                conversationId: conversationId,
                fileURL: fileURL,
                contentType: contentType
            )

            state.pendingMediaKey = attachment.mediaKey
            state.pendingMediaType = contentType.hasPrefix("image/") ? .image : .file
        } catch let error as APIError {
            state.error = L10n.message(for: error)
            state.sending = false
            return false
        } catch {
            state.error = L10n.string("error.server")
            state.sending = false
            return false
        }

        state.sending = false

        return await send(caption, mediaKey: state.pendingMediaKey)
    }

    /// The signed URL for one message's attachment. Short-lived by design, so
    /// it is fetched when somebody taps rather than kept beside the row.
    public func attachmentURL(for messageId: String) async -> URL? {
        do {
            return try await api.attachmentURL(messageId: messageId)
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }

        return nil
    }

    /// Images are sent as images so the conversation can show them inline; a
    /// wound photograph rendered as "dosya" is a photograph nobody looks at.
    private var messageType: MessageType? {
        guard state.pendingMediaKey != nil else { return nil }

        return state.pendingMediaType ?? .file
    }

    /// A message that arrived over the socket.
    public func receive(_ message: ChatMessage) {
        guard message.conversationId == state.conversationId else { return }

        append(message)
        state.typing.remove(message.senderId ?? "")
    }

    public func setTyping(_ userId: String, isTyping: Bool) {
        if isTyping {
            state.typing.insert(userId)
        } else {
            state.typing.remove(userId)
        }
    }

    public func markRead() async {
        guard let conversationId = state.conversationId else { return }

        _ = try? await api.markRead(conversationId: conversationId)
    }

    public func loadQuickReplies() async {
        state.quickReplies = (try? await api.quickReplies()) ?? []
    }

    /**
     * Appends, or replaces an existing row.
     *
     * The sender receives its own message twice — once from the POST and once
     * over the socket — and a chat that showed both would be a chat nobody
     * trusted.
     */
    private func append(_ message: ChatMessage) {
        if let index = state.messages.firstIndex(where: { $0.id == message.id }) {
            state.messages[index] = message
        } else {
            state.messages.append(message)
        }

        state.phase = .loaded
    }
}
