import Foundation
import KlinikAPI
import KlinikCore

/// Sends the alert.
///
/// A port rather than a concrete call, so the confirmation behaviour around it
/// is testable without a network. Returns the number the server says reaches an
/// ambulance where the patient is, when it answered with one — see
/// `EmergencyFallback` for why that is worth carrying back.
public protocol EmergencyTrigger: Sendable {
    func trigger(note: String?) async throws -> EmergencyNumber?
}

/**
 * The number to call when the app could not reach the clinic.
 *
 * The clinic's own answer for a country arrives with a *successful* alert, and
 * a failure is exactly the case where no server answered — so the useful number
 * has to already be on the phone. Two sources, in order: the last one the
 * server gave this device, and 112, which reaches an ambulance from any GSM
 * handset almost everywhere and does not depend on settling which national
 * number is current.
 */
public struct EmergencyFallback: Sendable, Equatable {
    public let number: String
    /// A second number to try, when the clinic named one.
    public let alsoTry: String?
    /// True when this is the universal GSM code rather than an answer for the
    /// country the patient is actually in. The screen says so.
    public let isUniversal: Bool

    public init(number: String, alsoTry: String? = nil, isUniversal: Bool) {
        self.number = number
        self.alsoTry = alsoTry
        self.isUniversal = isUniversal
    }

    /// Works from any GSM handset almost everywhere, with no server involved.
    public static let universal = EmergencyFallback(number: "112", isUniversal: true)

    public var dialURL: URL? { URL(string: "tel://\(number)") }
    public var secondDialURL: URL? { alsoTry.flatMap { URL(string: "tel://\($0)") } }
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

    /**
     * What to dial when the alert did not get through.
     *
     * Always present, never optional: a failure screen with nothing on it but
     * an apology is the one this whole flow exists to avoid.
     */
    public var fallback: EmergencyFallback = .universal

    public init() {}
}

/**
 Two-step confirmation for the emergency button (spec M8).

 Both mistakes are costly and they pull in opposite directions. A stray tap in a
 pocket spends clinical attention that someone else may need. A tap that fails
 to send, in a real emergency, is far worse — so nothing here reports success
 until the server has confirmed it, and a failure says plainly that the clinic
 does not know and gives a number that does not need the clinic.

 The state is published as a stream rather than only read on demand. The
 countdown runs inside this actor, and a screen that only looked after each tap
 would show a frozen number, let the window lapse behind a button that still
 looked live, and then swallow the confirming tap in silence.
 */
public actor EmergencyModel {
    /// Where the last number the server gave is kept, so a failure that happens
    /// with no connection still has the right country's number to offer.
    private static let storedNumberKey = "klinik.emergency.lastNumber"
    private static let storedAlsoTryKey = "klinik.emergency.lastAlsoTry"

    private let trigger: EmergencyTrigger
    private let confirmationWindow: Int
    private let defaults: UserDefaults

    private var countdownTask: Task<Void, Never>?
    private var pendingNote: String?
    private var listeners: [UUID: AsyncStream<EmergencyState>.Continuation] = [:]

    private(set) public var state = EmergencyState()

    /// - Parameter defaultsSuite: a private suite for tests. Built inside the
    ///   actor rather than injected, because `UserDefaults` is not `Sendable`
    ///   on every toolchain this is compiled with and a parameter would send
    ///   one across the isolation boundary.
    public init(
        trigger: EmergencyTrigger,
        confirmationWindowSeconds: Int = 5,
        defaultsSuite: String? = nil
    ) {
        self.trigger = trigger
        self.confirmationWindow = confirmationWindowSeconds
        self.defaults = defaultsSuite.flatMap(UserDefaults.init(suiteName:)) ?? .standard
        self.state.fallback = EmergencyModel.remembered(in: self.defaults)
    }

    public func currentState() -> EmergencyState { state }

    /**
     * Every change to the state, starting with the one in force now.
     *
     * The first value is sent immediately so a screen that starts listening
     * draws the truth rather than a default it has to correct a moment later.
     */
    public func updates() -> AsyncStream<EmergencyState> {
        let (stream, continuation) = AsyncStream<EmergencyState>.makeStream()
        let id = UUID()

        listeners[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.stopListening(id) }
        }
        continuation.yield(state)

        return stream
    }

    /// First tap. Arms the button and starts the countdown; sends nothing.
    public func arm(note: String? = nil) {
        guard case .idle = state.phase else { return }

        pendingNote = note
        set(.confirming(secondsRemaining: confirmationWindow))

        countdownTask?.cancel()
        countdownTask = Task { [confirmationWindow] in
            for remaining in stride(from: confirmationWindow - 1, through: 0, by: -1) {
                try? await Task.sleep(for: .seconds(1))
                if Task.isCancelled { return }
                await self.tick(remaining)
            }
        }
    }

    /**
     * Second tap. Only this sends.
     *
     * Accepted from a failure as well as from the armed state: "Tekrar dene" is
     * the same act, and a retry button that quietly did nothing would be worse
     * than no retry button at all.
     */
    public func confirm() async {
        switch state.phase {
        case .confirming, .failed:
            break
        default:
            return
        }

        countdownTask?.cancel()
        countdownTask = nil
        set(.sending)

        do {
            let number = try await trigger.trigger(note: pendingNote)

            if let number {
                remember(number)
            }

            set(.sent)
            pendingNote = nil
        } catch let error as APIError {
            // Offline is called out separately: the patient needs to know the
            // clinic has *not* been told, and to use the emergency number
            // instead of waiting.
            let message = error.isRetryable
                ? L10n.string("emergency.notSentRetry")
                : L10n.message(for: error)

            set(.failed(message: message, canRetry: error.isRetryable))
        } catch {
            set(.failed(message: L10n.string("emergency.notSentRetry"), canRetry: true))
        }
    }

    /// Explicit cancel, or leaving the screen.
    public func cancel() {
        countdownTask?.cancel()
        countdownTask = nil
        pendingNote = nil
        set(.idle)
    }

    /// Returns to idle after the patient has read the outcome.
    public func acknowledge() {
        switch state.phase {
        case .sent, .failed:
            set(.idle)
        default:
            break
        }
    }

    private func tick(_ remaining: Int) {
        guard case .confirming = state.phase else { return }

        if remaining <= 0 {
            // Disarmed by time rather than sent. A button that stays armed
            // indefinitely is one a pocket eventually presses — and the
            // countdown is on screen, so this is something the patient watched
            // happen rather than something done behind their back.
            pendingNote = nil
            set(.idle)
        } else {
            set(.confirming(secondsRemaining: remaining))
        }
    }

    private func set(_ phase: EmergencyPhase) {
        state.phase = phase
        publish()
    }

    private func publish() {
        for continuation in listeners.values {
            continuation.yield(state)
        }
    }

    private func stopListening(_ id: UUID) {
        listeners[id] = nil
    }

    /// Keeps the clinic's answer for wherever the patient is, so the next
    /// failure — which by definition cannot ask — has it already.
    private func remember(_ number: EmergencyNumber) {
        defaults.set(number.number, forKey: EmergencyModel.storedNumberKey)
        defaults.set(number.alsoTry, forKey: EmergencyModel.storedAlsoTryKey)

        state.fallback = EmergencyFallback(
            number: number.number,
            alsoTry: number.alsoTry,
            isUniversal: false
        )
    }

    private static func remembered(in defaults: UserDefaults) -> EmergencyFallback {
        guard
            let number = defaults.string(forKey: storedNumberKey),
            !number.isEmpty
        else {
            return .universal
        }

        return EmergencyFallback(
            number: number,
            alsoTry: defaults.string(forKey: storedAlsoTryKey),
            isUniversal: false
        )
    }
}
