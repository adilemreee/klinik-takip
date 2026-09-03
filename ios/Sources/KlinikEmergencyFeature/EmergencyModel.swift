import Foundation
import KlinikAPI
import KlinikCore

public struct Coordinates: Sendable, Equatable {
    public let latitude: Double
    public let longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

/// Whatever the app uses for location. Kept behind a protocol so the model can
/// be tested against a locator that never answers, which is the case that
/// matters.
public protocol EmergencyLocating: Sendable {
    func currentLocation() async -> Coordinates?
}

public enum EmergencyPhase: Sendable, Equatable {
    /// Nothing has happened. The button is on screen.
    case idle
    /// Pressed once. The second press within the window sends it.
    case armed
    case sending
    /// The alarm is with the clinic.
    case raised
    /// The request failed. The card is still shown — see `EmergencyState.card`.
    case failed(String)
}

public struct EmergencyState: Sendable, Equatable {
    public var phase: EmergencyPhase = .idle
    public var event: EmergencyEvent?
    /**
     * The card, from whichever source had it.
     *
     * Kept separately from the response so a failed trigger still shows the
     * emergency number. That is the whole point: if the network is gone, the
     * one thing on this screen that still works is a phone call, and it must
     * not disappear because a POST failed.
     */
    public var card: EmergencyGuidance?
    public var alreadyOpen = false

    public var canCancel: Bool { event?.status == .triggered }

    public init() {}
}

/**
 * The emergency button (spec M8).
 *
 * Three rules, in order of how badly they fail:
 *
 *   1. **Two presses, not one.** A single button that raises a clinical alarm
 *      will be pressed by a pocket. The arming window closes on its own, so a
 *      pocket that armed it does not leave it primed for the next pocket.
 *   2. **The location never delays the alarm.** A cold GPS takes fifteen
 *      seconds. The request goes with whatever is known by then and without
 *      anything if that is nothing.
 *   3. **A failure still leaves a phone number on screen.** The network being
 *      down is exactly when the local ambulance matters most.
 */
public actor EmergencyModel {
    private let api: EmergencyAPI
    private let locator: EmergencyLocating?
    private let locationTimeout: Duration
    private let armedWindow: Duration

    private(set) public var state = EmergencyState()
    private var armedAt: ContinuousClock.Instant?
    private var inFlight = false

    public init(
        api: EmergencyAPI,
        locator: EmergencyLocating? = nil,
        locationTimeout: Duration = .seconds(4),
        armedWindow: Duration = .seconds(10)
    ) {
        self.api = api
        self.locator = locator
        self.locationTimeout = locationTimeout
        self.armedWindow = armedWindow
    }

    public func currentState() -> EmergencyState { state }

    /// Loaded when the screen appears, long before anything is wrong.
    public func prefetch() async {
        if let existing = try? await api.active() {
            state.card = existing.guidance
            state.event = existing.event
            state.alreadyOpen = true
            state.phase = .raised
            return
        }

        if let card = try? await api.guidance() {
            state.card = card
        }
    }

    /// First press.
    public func arm() {
        guard state.phase == .idle || state.phase.isFailure else { return }

        state.phase = .armed
        armedAt = ContinuousClock.now
    }

    /// Backing out — an explicit cancel, or the window closing.
    public func disarm() {
        guard state.phase == .armed else { return }

        state.phase = .idle
        armedAt = nil
    }

    /**
     * Second press.
     *
     * Silently does nothing when the button was never armed, or when the window
     * has closed. Both are the same thing from the patient's side: the screen
     * has gone back to showing one button, and pressing it arms again.
     */
    public func confirm() async {
        guard state.phase == .armed, let armedAt else { return }

        guard ContinuousClock.now - armedAt < armedWindow else {
            disarm()
            return
        }

        // A second confirm while the first is still in flight would raise a
        // second alarm. The server refuses to open one, but the round trip is
        // wasted and the UI flickers between two responses.
        guard !inFlight else { return }

        inFlight = true
        state.phase = .sending
        defer { inFlight = false }

        let location = await locationWithinTimeout()

        do {
            let view = try await api.trigger(
                latitude: location?.latitude,
                longitude: location?.longitude
            )

            state.event = view.event
            state.card = view.guidance
            state.alreadyOpen = view.alreadyOpen
            state.phase = .raised
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }

        self.armedAt = nil
    }

    /// "I pressed it by accident", while nobody has picked it up yet.
    public func cancel() async {
        guard let event = state.event, event.status == .triggered else { return }

        do {
            let cancelled = try await api.cancel(event.id)
            state.event = cancelled
            state.phase = .idle
            state.alreadyOpen = false
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    /// Polled while the alarm is open, so the patient sees somebody picked up.
    public func refresh() async {
        guard let view = try? await api.active() else { return }

        state.event = view.event
        state.card = view.guidance
    }

    /**
     * Whatever the device knows by the deadline.
     *
     * Losing the race is not an error and is not reported as one — a pin is a
     * convenience, and waiting for one would spend the alarm's first seconds on
     * it.
     */
    private func locationWithinTimeout() async -> Coordinates? {
        guard let locator else { return nil }

        let timeout = locationTimeout

        return await withTaskGroup(of: Coordinates?.self) { group in
            group.addTask { await locator.currentLocation() }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }

            let first = await group.next() ?? nil
            group.cancelAll()

            return first
        }
    }
}

extension EmergencyPhase {
    var isFailure: Bool {
        if case .failed = self { return true }
        return false
    }
}
