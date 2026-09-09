#if canImport(UIKit)
import UIKit
import UserNotifications
#endif
import Foundation
import KlinikAPI
import KlinikCore

/**
 * Push registration and the buttons on a notification (spec M6).
 *
 * Two halves, and only one of them is about arriving messages. The first is
 * plumbing: ask, register with APNs, hand the token to the clinic, and give it
 * back on sign-out so a device stops receiving what it may no longer see.
 *
 * The second is the part the spec actually cares about — a reminder somebody
 * can answer without opening the app. "İçtim" and "1 saat ertele" are handled
 * here, from the notification, because a patient who has to open an app, find a
 * screen and press a third button is a patient who stops answering by Tuesday.
 *
 * The navigating actions ("Dosyayı aç") open the app and no more. Routing a
 * notification to one screen inside a tab's own navigation stack is a piece of
 * work this does not pretend to have done.
 */
@MainActor
public final class PushRegistrar: NSObject {
    private let notifications: NotificationsAPI
    private let medications: MedicationsAPI

    /// The last token handed to the clinic, so sign-out can revoke the right
    /// one. Not persisted: APNs reissues on launch, and a stale token revoked
    /// from a previous run would be somebody else's.
    private var registeredToken: String?

    public init(notifications: NotificationsAPI, medications: MedicationsAPI) {
        self.notifications = notifications
        self.medications = medications
        super.init()
    }

    /**
     * Asks, then registers.
     *
     * Called after sign-in rather than at first launch: a permission prompt
     * before somebody knows what the app is gets refused, and iOS only asks
     * once.
     */
    public func start() async {
        #if canImport(UIKit)
        let centre = UNUserNotificationCenter.current()
        centre.delegate = self
        centre.setNotificationCategories(PushRegistrar.categories)

        // The completion-handler form rather than the `async` one. Awaiting a
        // method on the centre hands the object itself across an actor
        // boundary, and it is not `Sendable` in every SDK this is built
        // against — only the `Bool` crosses here.
        let granted: Bool = await withCheckedContinuation { continuation in
            centre.requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
                continuation.resume(returning: granted)
            }
        }

        guard granted else { return }

        UIApplication.shared.registerForRemoteNotifications()
        #endif
    }

    /// Handed the token by the app delegate.
    public func received(deviceToken: Data) async {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()

        // A token that has not changed is not re-sent: APNs hands back the same
        // one on every launch, and the clinic does not need a write per launch.
        guard token != registeredToken else { return }

        do {
            try await notifications.registerToken(
                token,
                platform: "ios",
                deviceId: PushRegistrar.deviceIdentifier()
            )
            registeredToken = token
        } catch {
            // Not surfaced: somebody signing in does not need a dialog about
            // push registration, and the next launch tries again.
        }
    }

    /// On sign-out. A device that keeps its registration keeps receiving a
    /// patient's reminders after somebody else has taken the phone.
    public func stop() async {
        guard let token = registeredToken else { return }

        try? await notifications.revokeToken(token)
        registeredToken = nil
    }

    #if canImport(UIKit)
    /// The buttons, by notification type. The ids match the server's templates
    /// (`backend/src/notifications/templates.ts`); a mismatch shows a
    /// notification with no buttons, which is why they are listed together.
    static var categories: Set<UNNotificationCategory> {
        [
            category(
                "medication.due",
                actions: [
                    action("taken", "notification.action.taken"),
                    action("snooze", "notification.action.snooze"),
                ]
            ),
            category(
                "lab.ready",
                actions: [
                    action("open-lab", "notification.action.openLab", opensApp: true),
                    action("ask-doctor", "notification.action.askDoctor", opensApp: true),
                ]
            ),
            category(
                "lab.critical",
                actions: [
                    action("call-patient", "notification.action.callPatient", opensApp: true),
                    action("open-file", "notification.action.openFile", opensApp: true),
                ]
            ),
            category(
                "message.new",
                actions: [action("open-chat", "notification.action.openChat", opensApp: true)]
            ),
            category(
                "appointment.reminder",
                actions: [
                    action("open-appointment", "notification.action.openAppointment", opensApp: true),
                ]
            ),
        ]
    }

    private static func category(
        _ identifier: String,
        actions: [UNNotificationAction]
    ) -> UNNotificationCategory {
        UNNotificationCategory(
            identifier: identifier,
            actions: actions,
            intentIdentifiers: [],
            options: []
        )
    }

    private static func action(
        _ identifier: String,
        _ titleKey: String,
        opensApp: Bool = false
    ) -> UNNotificationAction {
        UNNotificationAction(
            identifier: identifier,
            title: L10n.string(titleKey),
            options: opensApp ? [.foreground] : []
        )
    }

    #endif

    /// Stable for the life of the install. Used so the clinic can replace a
    /// device's old token rather than accumulating one per launch.
    ///
    /// `@MainActor` spelled out: `UIDevice.current` is isolated in the SDK, and
    /// whether a `static` inherits its type's isolation is one of the things
    /// the two toolchains disagree about.
    @MainActor
    static func deviceIdentifier() -> String? {
        #if canImport(UIKit)
        return UIDevice.current.identifierForVendor?.uuidString
        #else
        return nil
        #endif
    }
}

#if canImport(UIKit)
extension PushRegistrar: UNUserNotificationCenterDelegate {
    /// Shown even while the app is open. A medication reminder suppressed
    /// because somebody happened to be reading their messages is a dose missed.
    public nonisolated func userNotificationCenter(
        _ centre: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    public nonisolated func userNotificationCenter(
        _ centre: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let action = response.actionIdentifier
        let info = response.notification.request.content.userInfo

        guard let logId = info["logId"] as? String else { return }

        await handle(action: action, logId: logId)
    }

    /// The two answers a patient can give without opening anything.
    private func handle(action: String, logId: String) async {
        switch action {
        case "taken":
            _ = try? await medications.checkIn(logId, action: .taken)

        case "snooze":
            _ = try? await medications.checkIn(logId, action: .snooze, snoozeMinutes: 60)

        default:
            // Everything else is a foreground action: iOS has already brought
            // the app up, and the screen it lands on is the one it was showing.
            break
        }
    }
}
#endif
