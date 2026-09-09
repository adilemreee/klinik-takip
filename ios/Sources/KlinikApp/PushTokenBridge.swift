#if canImport(UIKit)
import UIKit
#endif
import Foundation

/**
 * Where APNs hands the device token, and where the shell picks it up.
 *
 * A separate object because the two ends cannot see each other: the token
 * arrives on the application delegate, which only an app target may have, and
 * the registrar lives in this library where it can be built and read. Passing
 * it through a shared box is smaller than routing a delegate into the object
 * graph, and it is one variable rather than a protocol nobody else implements.
 */
@MainActor
public final class PushTokenBridge {
    public static let shared = PushTokenBridge()

    /// Set once somebody is signed in; nil while nobody is.
    public var registrar: PushRegistrar?

    private init() {}

    public func received(deviceToken: Data) {
        guard let registrar else { return }

        Task { await registrar.received(deviceToken: deviceToken) }
    }
}

#if canImport(UIKit)
/**
 * The delegate, which exists for one callback.
 *
 * `registerForRemoteNotifications()` answers through the application delegate
 * and nowhere else; SwiftUI has no equivalent. So this is the smallest possible
 * delegate: it takes the token and hands it on.
 */
public final class KlinikAppDelegate: NSObject, UIApplicationDelegate {
    public func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in PushTokenBridge.shared.received(deviceToken: deviceToken) }
    }

    public func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Nothing to tell the user: they cannot fix an APNs failure, and the
        // app works without push. The next launch tries again.
    }
}
#endif
