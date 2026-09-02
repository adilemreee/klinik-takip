import Foundation
import KlinikAPI
import KlinikCore

public enum SettingsPhase: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

public struct NotificationSettingsState: Sendable, Equatable {
    public var phase: SettingsPhase = .loading
    public var preferences: [NotificationPreference] = []
    public var history: [DeliveredNotification] = []
    /// The row being saved, so its switch can be disabled.
    public var saving: String?
    public var error: String?

    /**
     * Whether a type is on for a channel.
     *
     * Absent means on: someone who never opened this screen still gets told
     * their results are ready. Only a stored `false` silences anything, which is
     * the same rule the server applies — if the two disagreed, the switch would
     * show one thing and the clinic would do another.
     */
    public func isEnabled(_ type: NotificationKind, _ channel: NotificationChannel) -> Bool {
        preferences
            .first { $0.type == type.rawValue && $0.channel == channel }?
            .enabled ?? true
    }

    public func quietHours(_ type: NotificationKind) -> (start: String, end: String)? {
        guard let match = preferences.first(where: {
            $0.type == type.rawValue && $0.channel == .push
        }),
            let start = match.quietHoursStart,
            let end = match.quietHoursEnd
        else { return nil }

        return (start, end)
    }

    public init() {}
}

/// The notification preferences screen (spec M6).
public actor NotificationSettingsModel {
    private let api: NotificationsAPI

    private(set) public var state = NotificationSettingsState()

    public init(api: NotificationsAPI) {
        self.api = api
    }

    public func currentState() -> NotificationSettingsState { state }

    public func load() async {
        state.phase = .loading

        do {
            async let preferences = api.preferences()
            async let history = api.history()

            state.preferences = try await preferences
            state.history = try await history
            state.phase = .loaded
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    /**
     * Turns a type on or off for a channel.
     *
     * The saved row replaces the local one rather than the switch keeping its
     * own idea of the answer: a switch that stays flipped after the server
     * refused is a setting the person believes they made.
     */
    @discardableResult
    public func set(
        _ type: NotificationKind,
        channel: NotificationChannel,
        enabled: Bool
    ) async -> Bool {
        let key = "\(type.rawValue)|\(channel.rawValue)"
        guard state.saving == nil else { return false }

        state.saving = key
        state.error = nil
        defer { state.saving = nil }

        do {
            let quiet = state.quietHours(type)
            let saved = try await api.setPreference(
                type: type,
                channel: channel,
                enabled: enabled,
                quietHoursStart: quiet?.start,
                quietHoursEnd: quiet?.end
            )

            replace(saved)
        } catch let error as APIError {
            state.error = L10n.message(for: error)
            return false
        } catch {
            state.error = L10n.string("error.server")
            return false
        }

        return true
    }

    @discardableResult
    public func setQuietHours(
        _ type: NotificationKind,
        start: String?,
        end: String?
    ) async -> Bool {
        guard state.saving == nil else { return false }

        state.saving = type.rawValue
        state.error = nil
        defer { state.saving = nil }

        do {
            let saved = try await api.setPreference(
                type: type,
                channel: .push,
                enabled: state.isEnabled(type, .push),
                quietHoursStart: start,
                quietHoursEnd: end
            )

            replace(saved)
        } catch let error as APIError {
            state.error = L10n.message(for: error)
            return false
        } catch {
            state.error = L10n.string("error.server")
            return false
        }

        return true
    }

    /// Registers this device once the system has granted permission.
    public func registerDevice(token: String, deviceId: String?) async {
        try? await api.registerToken(token, platform: "ios", deviceId: deviceId)
    }

    /// On sign-out: the device stops receiving what it may no longer see.
    public func forgetDevice(token: String) async {
        try? await api.revokeToken(token)
    }

    public func markHistoryRead() async {
        _ = try? await api.markRead()
    }

    private func replace(_ preference: NotificationPreference) {
        if let index = state.preferences.firstIndex(where: { $0.id == preference.id }) {
            state.preferences[index] = preference
        } else {
            state.preferences.append(preference)
        }
    }
}
