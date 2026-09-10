import Foundation

/**
 * Recording a voice message, as a screen sees it (spec M3).
 *
 * Three closures rather than an object, so a feature module can offer the
 * button without importing AVFoundation or the shell — the same shape the
 * device lock and the file picker already use.
 *
 * `isAvailable` false leaves the button out rather than showing one that
 * cannot work: the staff build has no reason to record, and a simulator with
 * no input device would fail on the first tap.
 */
public struct VoiceRecording: Sendable {
    public let isAvailable: Bool
    /// False when the microphone was refused. Not a failure to apologise for —
    /// the person said no, and the button should stop offering.
    public let start: @Sendable () async -> Bool
    /// The file, or nil for a recording with nothing in it.
    public let stop: @Sendable () async -> (url: URL, contentType: String)?
    public let cancel: @Sendable () -> Void

    public init(
        isAvailable: Bool,
        start: @escaping @Sendable () async -> Bool,
        stop: @escaping @Sendable () async -> (url: URL, contentType: String)?,
        cancel: @escaping @Sendable () -> Void
    ) {
        self.isAvailable = isAvailable
        self.start = start
        self.stop = stop
        self.cancel = cancel
    }
}
