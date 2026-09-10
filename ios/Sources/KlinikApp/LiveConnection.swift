import Foundation
import Observation
import SocketIO
import KlinikAPI
import KlinikCore

/**
 * The live half of messaging (spec section 3.2: REST + WebSocket).
 *
 * Messages are still *sent* over REST — a socket that drops mid-send leaves
 * the client unsure whether the message exists, and a POST either returns an
 * id or does not. This carries delivery and the typing indicator, which are
 * the two things that are worthless a minute late.
 *
 * Owned by the shell rather than by a screen, for the same reason push
 * registration is: a connection belongs to the session, and a chat screen that
 * opened its own would open a second one the next time somebody navigated back
 * into it.
 *
 * The token is fetched fresh on every connect. Sockets outlive access tokens —
 * an hour on a ward round is longer than a token's life — and a reconnect
 * carrying the expired one is refused at the handshake, which looks exactly
 * like the clinic being unreachable.
 */
@MainActor
@Observable
public final class LiveConnection: LiveChannel {
    /// Whether the socket is carrying anything. Reads still work without it;
    /// this is not the app's connectivity indicator.
    public private(set) var isConnected = false

    private let baseURL: URL
    private let session: SessionManager

    /// Where each conversation's events go. One handler per conversation: a
    /// second screen on the same thread replaces the first, which is what
    /// navigating back and forward does.
    private var handlers: [String: @MainActor (LiveEvent) -> Void] = [:]

    private var manager: SocketManager?
    private var socket: SocketIOClient?

    /// Conversations to (re)join. Kept because a reconnect starts with no
    /// rooms: the server's join check runs per connection, deliberately, and a
    /// client that assumed otherwise would go quiet after the first blip.
    private var joined: Set<String> = []

    public init(baseURL: URL, session: SessionManager) {
        self.baseURL = baseURL
        self.session = session
    }

    public func subscribe(
        _ conversationId: String,
        _ handler: @escaping @MainActor (LiveEvent) -> Void
    ) {
        handlers[conversationId] = handler
    }

    public func unsubscribe(_ conversationId: String) {
        handlers[conversationId] = nil
    }

    /// Routed by conversation, so a screen never sees another thread's events.
    private func deliver(_ event: LiveEvent, to conversationId: String) {
        handlers[conversationId]?(event)
    }

    /// Opens the connection. Does nothing if one is already open.
    public func start() async {
        guard manager == nil else { return }
        guard let token = try? await session.validAccessToken() else { return }

        let manager = SocketManager(
            socketURL: baseURL,
            config: [
                .log(false),
                .compress,
                // In the handshake, never the query string: a URL ends up in
                // proxy logs and browser history, and an access token there
                // outlives the connection that needed it.
                .connectParams([:]),
                .extraHeaders(["Authorization": "Bearer \(token)"]),
                .reconnects(true),
                .reconnectWait(2),
                .reconnectWaitMax(30),
            ]
        )

        let socket = manager.socket(forNamespace: "/messaging")

        socket.on(clientEvent: .connect) { [weak self] _, _ in
            Task { @MainActor in await self?.didConnect() }
        }

        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            Task { @MainActor in self?.isConnected = false }
        }

        socket.on("message") { [weak self] data, _ in
            guard let message = LiveConnection.decode(ChatMessage.self, from: data) else { return }

            Task { @MainActor in
                self?.deliver(.message(message), to: message.conversationId)
            }
        }

        socket.on("typing") { [weak self] data, _ in
            guard let payload = LiveConnection.decode(TypingPayload.self, from: data) else { return }

            Task { @MainActor in
                self?.deliver(
                    .typing(conversationId: payload.conversationId, userId: payload.userId),
                    to: payload.conversationId
                )
            }
        }

        socket.on("read") { [weak self] data, _ in
            guard let payload = LiveConnection.decode(ReadPayload.self, from: data) else { return }

            Task { @MainActor in
                self?.deliver(
                    .read(conversationId: payload.conversationId, readerId: payload.readerId),
                    to: payload.conversationId
                )
            }
        }

        self.manager = manager
        self.socket = socket

        socket.connect()
    }

    /// Closes it. Called when the session ends: a socket authenticated as one
    /// person must not still be delivering when the next one signs in.
    public func stop() {
        socket?.removeAllHandlers()
        socket?.disconnect()
        manager?.disconnect()

        socket = nil
        manager = nil
        joined = []
        handlers = [:]
        isConnected = false
    }

    /**
     * Joins a conversation's room.
     *
     * Remembered as well as sent, because the server checks the caller may see
     * the conversation *per connection*. After a reconnect the rooms are gone,
     * and a client that did not rejoin would look connected and deliver
     * nothing.
     */
    public func join(_ conversationId: String) {
        joined.insert(conversationId)
        socket?.emit("join", ["conversationId": conversationId])
    }

    public func leave(_ conversationId: String) {
        joined.remove(conversationId)
        socket?.emit("leave", ["conversationId": conversationId])
    }

    /// Tells the room somebody is writing. Never stored anywhere: it is true
    /// for a few seconds and then it is not.
    public func typing(in conversationId: String) {
        socket?.emit("typing", ["conversationId": conversationId])
    }

    private func didConnect() async {
        isConnected = true

        for conversationId in joined {
            socket?.emit("join", ["conversationId": conversationId])
        }
    }

    /**
     * One socket.io payload, as a decoded type.
     *
     * The library hands over `[Any]` from JSON, so it goes back through
     * JSONSerialization rather than being cast field by field — which keeps
     * one decoder, the client's own, deciding what a message looks like.
     *
     * `nonisolated` because it is a pure function of its argument and the
     * handlers run off the main actor.
     */
    nonisolated static func decode<T: Decodable>(_ type: T.Type, from data: [Any]) -> T? {
        guard
            let first = data.first,
            JSONSerialization.isValidJSONObject(first),
            let encoded = try? JSONSerialization.data(withJSONObject: first)
        else {
            return nil
        }

        return try? JSONDecoder.klinik.decode(type, from: encoded)
    }
}

private struct TypingPayload: Decodable, Sendable {
    let conversationId: String
    let userId: String
}

private struct ReadPayload: Decodable, Sendable {
    let conversationId: String
    let readerId: String
}
