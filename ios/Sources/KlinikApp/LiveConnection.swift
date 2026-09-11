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
 * The token is fetched fresh on every connect, and reconnection is driven here
 * rather than left to the library. Sockets outlive access tokens — an hour on a
 * ward round is longer than a token's life — and socket.io's own reconnect
 * replays the handshake headers it was built with, so every attempt after the
 * token expires is refused. What that looked like was a connection that worked
 * for an hour and then went quiet until the app was restarted, with nothing on
 * screen to say so.
 */
@MainActor
@Observable
public final class LiveConnection: LiveChannel, JobChannel {
    /// Whether the socket is carrying anything. Reads still work without it;
    /// this is not the app's connectivity indicator.
    public private(set) var isConnected = false

    private let baseURL: URL
    private let session: SessionManager

    /// Where each conversation's events go. One handler per conversation: a
    /// second screen on the same thread replaces the first, which is what
    /// navigating back and forward does.
    private var handlers: [String: @MainActor (LiveEvent) -> Void] = [:]

    /// Job handlers, per patient, and the patients to re-watch after a
    /// reconnect — the server's scope check runs per connection.
    private var jobHandlers: [String: @MainActor (JobUpdate) -> Void] = [:]
    private var watching: Set<String> = []

    private var manager: SocketManager?
    private var socket: SocketIOClient?

    /// True between `start()` and `stop()`. A dropped connection is worth
    /// chasing only while somebody still wants one.
    private var wantsConnection = false
    private var reconnectTask: Task<Void, Never>?
    private var failedAttempts = 0

    /// A second namespace over the same connection, not a second connection:
    /// socket.io multiplexes, and a phone holding two sockets to the same host
    /// is a phone spending twice the battery to hear the same silence.
    private var jobs: SocketIOClient?

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
        wantsConnection = true
        await connect()
    }

    private func connect() async {
        guard wantsConnection, manager == nil else { return }

        guard let token = try? await session.validAccessToken() else {
            // No token to hand over — the session may be refreshing, or gone.
            // Worth another try; `stop()` is what says otherwise.
            scheduleReconnect()
            return
        }

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
                // Off, deliberately. The library would reconnect with the
                // headers above, and the token in them is the thing that goes
                // stale — see the note on this type.
                .reconnects(false),
            ]
        )

        let socket = manager.socket(forNamespace: "/messaging")

        socket.on(clientEvent: .connect) { [weak self] _, _ in
            Task { @MainActor in await self?.didConnect() }
        }

        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            Task { @MainActor in self?.didDisconnect() }
        }

        socket.on(clientEvent: .error) { [weak self] _, _ in
            // A refused handshake arrives here, which is exactly the case a
            // stale token produces.
            Task { @MainActor in self?.didDisconnect() }
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

        let jobs = manager.socket(forNamespace: "/jobs")

        jobs.on(clientEvent: .connect) { [weak self] _, _ in
            Task { @MainActor in self?.didConnectJobs() }
        }

        jobs.on(clientEvent: .disconnect) { [weak self] _, _ in
            Task { @MainActor in self?.didDisconnect() }
        }

        jobs.on("job") { [weak self] data, _ in
            guard
                let update = LiveConnection.decode(JobUpdate.self, from: data),
                let patientId = update.patientId
            else {
                return
            }

            Task { @MainActor in self?.jobHandlers[patientId]?(update) }
        }

        self.manager = manager
        self.socket = socket
        self.jobs = jobs

        socket.connect()
        jobs.connect()
    }

    /// Closes it. Called when the session ends: a socket authenticated as one
    /// person must not still be delivering when the next one signs in.
    public func stop() {
        wantsConnection = false
        reconnectTask?.cancel()
        reconnectTask = nil
        failedAttempts = 0

        tearDown()

        joined = []
        watching = []
        handlers = [:]
        jobHandlers = [:]
    }

    /// Drops the sockets but keeps what has been subscribed to, so a reconnect
    /// can put the rooms back.
    private func tearDown() {
        socket?.removeAllHandlers()
        socket?.disconnect()
        jobs?.removeAllHandlers()
        jobs?.disconnect()
        manager?.disconnect()

        socket = nil
        jobs = nil
        manager = nil
        isConnected = false
    }

    private func didDisconnect() {
        isConnected = false
        scheduleReconnect()
    }

    /**
     * Tries again, with a fresh token and a widening gap.
     *
     * The whole connection is rebuilt rather than resumed, because the point of
     * trying again is the new token in the handshake. Backoff so a clinic
     * behind a proxy that refuses the upgrade is not asked twice a second all
     * day.
     */
    private func scheduleReconnect() {
        guard wantsConnection, reconnectTask == nil else { return }

        let delay = LiveConnection.backoff(afterFailures: failedAttempts)
        failedAttempts += 1

        reconnectTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(delay))

            guard !Task.isCancelled, let self else { return }

            self.reconnectTask = nil
            self.tearDown()
            await self.connect()
        }
    }

    /// Two seconds, doubling, capped at thirty.
    nonisolated static func backoff(afterFailures failures: Int) -> Double {
        min(30, 2 * pow(2, Double(min(failures, 4))))
    }

    // MARK: - Background work (spec M14)

    public func watch(_ patientId: String) {
        watching.insert(patientId)
        jobs?.emit("watch", ["patientId": patientId])
    }

    public func unwatch(_ patientId: String) {
        watching.remove(patientId)
        jobs?.emit("unwatch", ["patientId": patientId])
    }

    public func onJob(_ patientId: String, _ handler: @escaping @MainActor (JobUpdate) -> Void) {
        jobHandlers[patientId] = handler
    }

    public func stopJobs(_ patientId: String) {
        jobHandlers[patientId] = nil
    }

    private func didConnectJobs() {
        for patientId in watching {
            jobs?.emit("watch", ["patientId": patientId])
        }
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
        // A connection that lasted is the only evidence the backoff should
        // start over from.
        failedAttempts = 0

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
