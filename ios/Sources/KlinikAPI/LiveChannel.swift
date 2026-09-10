import Foundation

/// What arrived over the socket (spec section 3.2: REST + WebSocket).
public enum LiveEvent: Sendable, Equatable {
    /// A message was delivered to a conversation this connection has joined.
    case message(ChatMessage)
    /// Somebody else is typing.
    case typing(conversationId: String, userId: String)
    /// Messages were read, so the sender's ticks can change.
    case read(conversationId: String, readerId: String)
}

/**
 * The live half of a conversation, as a screen sees it.
 *
 * Declared here so a feature module can take one without importing the shell,
 * and satisfied there — because a connection belongs to the session, not to a
 * screen. A chat that opened its own would open a second one the next time
 * somebody navigated back into it, and the clinic would be delivering the same
 * message twice.
 *
 * Messages are still *sent* over REST. A socket that drops mid-send leaves the
 * client unsure whether the message exists; a POST either returns an id or does
 * not. This carries delivery and typing, which are the two things that are
 * worthless a minute late.
 */
@MainActor
public protocol LiveChannel: AnyObject {
    /// Asks the server for this conversation's events. The check that the
    /// caller may see it runs there, per connection.
    func join(_ conversationId: String)
    func leave(_ conversationId: String)
    /// Tells the room somebody is writing. Never stored: it is true for a few
    /// seconds and then it is not.
    func typing(in conversationId: String)

    /// Where events for one conversation should go. One handler per
    /// conversation: a second screen on the same thread replaces the first,
    /// which is what navigating back and forward does.
    func subscribe(_ conversationId: String, _ handler: @escaping @MainActor (LiveEvent) -> Void)
    func unsubscribe(_ conversationId: String)
}

/// A job's status, as it changed (spec M14).
public struct JobUpdate: Decodable, Sendable, Equatable {
    public let jobId: String
    public let patientId: String?
    /// What the job is about, e.g. `documents`.
    public let entityType: String?
    public let entityId: String?
    public let queue: String
    public let name: String
    public let status: ProcessingStatus
    /// Set only when it failed, and already safe to show staff.
    public let error: String?

    /// Whether the work is over, one way or another — the moment a screen
    /// showing a spinner has something new to read.
    public var isSettled: Bool { status.isSettled }
}

/**
 * Watching a patient's background work, as a screen sees it.
 *
 * A courtesy on top of a correct screen: the lists poll while anything is
 * unsettled and read the truth from the server, so a dropped event costs a few
 * seconds and never a wrong answer. That is why nothing here replays or
 * buffers — an announcement that arrives late has already been overtaken by
 * the read that made it unnecessary.
 */
@MainActor
public protocol JobChannel: AnyObject {
    /// Asks for this patient's job events. The scope check runs on the server,
    /// per connection.
    func watch(_ patientId: String)
    func unwatch(_ patientId: String)

    func onJob(_ patientId: String, _ handler: @escaping @MainActor (JobUpdate) -> Void)
    func stopJobs(_ patientId: String)
}
