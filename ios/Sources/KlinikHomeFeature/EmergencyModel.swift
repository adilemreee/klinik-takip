import Foundation
import KlinikCore

/// Sends the alert. A port rather than a concrete call: the endpoint arrives
/// with the emergency module in T4.5, and the confirmation behaviour around it
/// is worth having and testing now.
public protocol EmergencyTrigger: Sendable {
    func trigger(note: String?) async throws
}

public enum EmergencyPhase: Sendable, Equatable {
    case idle
    /// Armed and waiting for the confirming tap. Disarms on its own.
    case confirming(secondsRemaining: Int)
    case sending
    /// The clinic has it. Only ever set after the server confirms.
    case sent
    /// It did not reach the clinic. `reachedClinic` is false, and the screen
    /// must say so rather than leaving the patient to assume help is coming.
    case failed(message: String, canRetry: Bool)
}

public struct EmergencyState: Sendable, Equatable {
    public var phase: EmergencyPhase = .idle

    public init() {}
}

/**
 Two-step confirmation for the emergency button (spec M8).

 Both mistakes are costly and they pull in opposite directions. A stray tap in a
 pocket spends clinical attention that someone else may need. A tap that fails
 to send, in a real emergency, is far worse — so nothing here reports success
 until the server has confirmed it, and a failure says plainly that the clinic
 does not know.
 */
public actor EmergencyModel {
    private let trigger: EmergencyTrigger
    private let confirmationWindow: Int

    private var countdownTask: Task<Void, Never>?
    private var pendingNote: String?

    private(set) public var state = EmergencyState()

    public init(trigger: EmergencyTrigger, confirmationWindowSeconds: Int = 5) {
        self.trigger = trigger
        self.confirmationWindow = confirmationWindowSeconds
    }

    public func currentState() -> EmergencyState { state }

    /// First tap. Arms the button and starts the countdown; sends nothing.
    public func arm(note: String? = nil) {
        guard case .idle = state.phase else { return }

        pendingNote = note
        state.phase = .confirming(secondsRemaining: confirmationWindow)

        countdownTask?.cancel()
        countdownTask = Task { [confirmationWindow] in
            for remaining in stride(from: confirmationWindow - 1, through: 0, by: -1) {
                try? await Task.sleep(for: .seconds(1))
                if Task.isCancelled { return }
                await self.tick(remaining)
            }
        }
    }

    /// Second tap. Only this sends.
    public func confirm() async {
        guard case .confirming = state.phase else { return }

        countdownTask?.cancel()
        countdownTask = nil
        state.phase = .sending

        do {
            try await trigger.trigger(note: pendingNote)
            state.phase = .sent
            pendingNote = nil
        } catch let error as APIError {
            // Offline is called out separately: the patient needs to know the
            // clinic has *not* been told, and to use the local emergency number
            // instead of waiting.
            let message = error.isRetryable
                ? L10n.string("emergency.notSentRetry")
                : L10n.message(for: error)

            state.phase = .failed(message: message, canRetry: error.isRetryable)
        } catch {
            state.phase = .failed(
                message: L10n.string("emergency.notSentRetry"),
                canRetry: true
            )
        }
    }

    /// Explicit cancel, or leaving the screen.
    public func cancel() {
        countdownTask?.cancel()
        countdownTask = nil
        pendingNote = nil
        state.phase = .idle
    }

    /// Returns to idle after the patient has read the outcome.
    public func acknowledge() {
        guard case .sent = state.phase else {
            if case .failed = state.phase { state.phase = .idle }
            return
        }

        state.phase = .idle
    }

    private func tick(_ remaining: Int) {
        guard case .confirming = state.phase else { return }

        if remaining <= 0 {
            // Disarmed by time rather than sent. A button that stays armed
            // indefinitely is one a pocket eventually presses.
            state.phase = .idle
            pendingNote = nil
        } else {
            state.phase = .confirming(secondsRemaining: remaining)
        }
    }
}
