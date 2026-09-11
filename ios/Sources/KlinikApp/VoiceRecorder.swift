import Foundation
import KlinikAPI

#if canImport(AVFoundation) && os(iOS)
import AVFoundation
#endif

/**
 * Recording a voice message (spec M3).
 *
 * Somebody three days after an operation, in a language they are not fluent
 * in, describing where it hurts — typing that is work, and saying it is not.
 * The clinic gets what they actually said rather than what they managed to
 * write.
 *
 * AAC in an m4a container, because that is what the server accepts and what
 * every phone plays. Mono at 32 kbit/s: a spoken sentence, not music, and a
 * patient on hotel wifi should not be sending a megabyte a minute.
 *
 * **No transcription yet.** The field is on the message and stays empty until
 * the clinic chooses a provider — sending somebody's voice to a third party is
 * a decision about a new category of data, and not one this app makes on their
 * behalf.
 */
@MainActor
public final class VoiceRecorder {
    /// Long enough for somebody to describe a symptom, short enough that a
    /// pocket recording is not twenty minutes of nothing.
    public static let maximumDuration: TimeInterval = 180

    public init() {}

#if canImport(AVFoundation) && os(iOS)
    private var recorder: AVAudioRecorder?
    private var fileURL: URL?
    /// When `record` was called. See `stop()` for why the recorder's own clock
    /// is not enough.
    private var startedAt: Date?

    /**
     * Asks for the microphone, then starts.
     *
     * Returns false when permission is refused, which the screen shows as an
     * explanation rather than a failure — the person did not do anything
     * wrong, they said no, and the button should stop offering.
     */
    public func start() async -> Bool {
        guard await VoiceRecorder.permitted() else { return false }

        let session = AVAudioSession.sharedInstance()

        do {
            try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.duckOthers])
            try session.setActive(true)
        } catch {
            return false
        }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("m4a")

        do {
            let recorder = try AVAudioRecorder(
                url: url,
                settings: [
                    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                    AVSampleRateKey: 24_000,
                    AVNumberOfChannelsKey: 1,
                    AVEncoderBitRateKey: 32_000,
                    AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
                ]
            )

            guard recorder.record(forDuration: VoiceRecorder.maximumDuration) else { return false }

            self.recorder = recorder
            fileURL = url
            startedAt = Date()

            return true
        } catch {
            return false
        }
    }

    /**
     * Stops and hands over the file.
     *
     * Nil for a recording with nothing in it: a tap that starts and stops
     * inside a second produces a file the clinician would open, hear silence
     * from, and wonder about.
     */
    public func stop() -> (url: URL, contentType: String)? {
        guard let recorder, let url = fileURL else { return nil }

        /*
         * How long was recorded, from whichever clock still knows.
         *
         * `currentTime` reads zero once the recorder has stopped — and it stops
         * itself at the ceiling passed to `record(forDuration:)`, and again if
         * a phone call interrupts it. Trusting it alone meant a full three
         * minutes of somebody describing a symptom was measured as zero
         * seconds and deleted as an accidental tap.
         */
        let duration = recorder.isRecording
            ? recorder.currentTime
            : Date().timeIntervalSince(startedAt ?? Date())

        recorder.stop()
        release()

        // Under a second: a tap that started and stopped. Sending it would give
        // the clinician silence to wonder about.
        guard duration >= 1 else {
            try? FileManager.default.removeItem(at: url)
            return nil
        }

        return (url, "audio/mp4")
    }

    /// Throws the recording away. The bytes go with it — an abandoned voice
    /// note is one somebody decided not to send.
    public func cancel() {
        recorder?.stop()

        if let fileURL {
            try? FileManager.default.removeItem(at: fileURL)
        }

        release()
    }

    private func release() {
        recorder = nil
        fileURL = nil
        startedAt = nil

        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /**
     * The microphone permission.
     *
     * Wrapped in a continuation rather than awaited directly: the API is a
     * completion handler on a framework object, and awaiting the object itself
     * is the mistake this codebase has made twice before.
     */
    private static func permitted() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    /**
     * The three closures a screen needs, with no AVFoundation in sight.
     *
     * Each hops to the main actor explicitly. The closures are `@Sendable` and
     * therefore nonisolated, and this type is not — calling a synchronous
     * main-actor method from one compiles on macOS, where the iOS branch is
     * never built, and fails for the real app. Spelling the hop out is the
     * rule this codebase already wrote down twice.
     */
    public var handle: VoiceRecording {
        VoiceRecording(
            isAvailable: true,
            start: { [weak self] in await self?.start() ?? false },
            stop: { [weak self] in await MainActor.run { self?.stop() } },
            // Fire and forget: nobody waits to hear that a recording they
            // abandoned has been abandoned.
            cancel: { [weak self] in Task { @MainActor in self?.cancel() } }
        )
    }
#else
    /**
     * Off the phone there is no microphone to open.
     *
     * The type still exists so the navigation compiles for macOS — which is
     * what `swift test` builds, and the reason the whole package is buildable
     * there in the first place. `isAvailable` false leaves the button out
     * rather than showing one that cannot work.
     */
    public var handle: VoiceRecording {
        VoiceRecording(
            isAvailable: false,
            start: { false },
            stop: { nil },
            cancel: {}
        )
    }
#endif
}
