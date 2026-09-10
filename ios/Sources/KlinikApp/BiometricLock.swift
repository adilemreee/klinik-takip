#if canImport(LocalAuthentication)
import LocalAuthentication
#endif
import Foundation
import Observation
import SwiftUI
import KlinikCore
import KlinikDesign

/// What kind of check the device offers, so the button can name it. A button
/// saying "Face ID" on a phone with a fingerprint reader is a button nobody
/// presses.
public enum BiometryKind: Sendable, Equatable {
    case none
    case faceID
    case touchID
    /// Optic ID, or a future one this build has no name for.
    case other

    public var localizedName: String {
        switch self {
        case .none: return ""
        case .faceID: return L10n.string("biometrics.faceID")
        case .touchID: return L10n.string("biometrics.touchID")
        case .other: return L10n.string("biometrics.generic")
        }
    }
}

/**
 * The lock over the app's own screens (spec M1).
 *
 * Deliberately *not* implemented by putting the keychain item behind biometry.
 * The tokens are stored with `AfterFirstUnlock` precisely so a background
 * refresh and a push handler can read them while the phone is locked — that is
 * what makes medication reminders and the emergency escalation work — and
 * requiring a face to read them would break both.
 *
 * So this locks the interface rather than the credentials: the session stays
 * valid, background work continues, and nothing clinical is drawn until
 * somebody has proved they are the person the phone belongs to. That is the
 * threat this is actually for — a handset left on a ward desk, not a stolen
 * database.
 *
 * Off by default. A clinic phone passed between three nurses would be locked
 * to whichever one enrolled their face, and that is a decision for them.
 */
@MainActor
@Observable
public final class BiometricLock {
    private static let preferenceKey = "xyz.klinik.biometricLock"

    /**
     * How long the app may sit in the background before it locks again.
     *
     * Not zero. The document picker, the camera and a QuickLook preview all
     * put the app behind something, and demanding a face scan on the way back
     * from choosing a photograph is how people turn the lock off. A minute is
     * long enough for that and short enough that a handset left on a ward desk
     * is locked by the time somebody else picks it up — which is the threat
     * this is actually for.
     */
    public static let grace: TimeInterval = 60

    private let defaults: UserDefaults
    private let now: @Sendable () -> Date

    /// True until somebody passes the check.
    public private(set) var isLocked: Bool

    /// When the app was last put away. Nil while it is in front.
    private var leftAt: Date?

    public init(defaults: UserDefaults = .standard, now: @escaping @Sendable () -> Date = Date.init) {
        self.defaults = defaults
        self.now = now
        isLocked = defaults.bool(forKey: BiometricLock.preferenceKey)
    }

    public var isEnabled: Bool {
        defaults.bool(forKey: BiometricLock.preferenceKey)
    }

    public var kind: BiometryKind {
        #if canImport(LocalAuthentication)
        let context = LAContext()
        var error: NSError?

        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        else { return .none }

        switch context.biometryType {
        case .faceID: return .faceID
        case .touchID: return .touchID
        case .none: return .none
        @unknown default: return .other
        }
        #else
        return .none
        #endif
    }

    public var isAvailable: Bool { kind != .none }

    /// Turning it on locks nothing until the next launch; turning it off
    /// unlocks immediately, because somebody who just proved who they are to
    /// change the setting has already answered the question.
    public func setEnabled(_ enabled: Bool) {
        defaults.set(enabled, forKey: BiometricLock.preferenceKey)

        if !enabled {
            isLocked = false
            leftAt = nil
        }
    }

    /**
     * The app went away.
     *
     * The time is recorded rather than the lock being thrown immediately,
     * because "away" includes the two seconds it takes to pick a file. What
     * decides is how long it was away, and that is only known on the way back.
     */
    public func wentAway() {
        guard isEnabled, !isLocked else { return }

        leftAt = now()
    }

    /**
     * The app came back.
     *
     * Locks again if it was away longer than the grace. Before this, the lock
     * only ever guarded a cold launch: unlock once in the morning and the
     * phone was open all day, which is precisely the handset-on-a-ward-desk
     * case the lock exists for.
     */
    public func cameBack() {
        guard isEnabled, let leftAt else { return }

        if now().timeIntervalSince(leftAt) >= BiometricLock.grace {
            isLocked = true
        }

        self.leftAt = nil
    }

    /// Asks the device. Returns false on cancellation as well as failure —
    /// the screen treats them the same, because both mean "not unlocked" and
    /// distinguishing them would only tell an onlooker which it was.
    @discardableResult
    public func unlock() async -> Bool {
        #if canImport(LocalAuthentication)
        let context = LAContext()

        // Falls back to the passcode: a face that will not scan — a mask, a
        // bandage after surgery, a nurse in a visor — must not lock somebody
        // out of a clinical record they are entitled to see.
        let policy = LAPolicy.deviceOwnerAuthentication

        guard context.canEvaluatePolicy(policy, error: nil) else {
            // No biometry and no passcode set. Locking the app behind a check
            // the device cannot make would strand the user entirely.
            isLocked = false
            return true
        }

        // Completion handler rather than `async`, as everywhere else a framework
        // object would otherwise be sent across an actor boundary: `LAContext`
        // is not `Sendable` in every SDK this is built against, and only the
        // `Bool` needs to cross.
        let passed: Bool = await withCheckedContinuation { continuation in
            context.evaluatePolicy(
                policy,
                localizedReason: L10n.string("biometrics.reason")
            ) { success, _ in
                continuation.resume(returning: success)
            }
        }

        if passed { isLocked = false }

        return passed
        #else
        isLocked = false
        return true
        #endif
    }
}

/**
 * What is on screen while the app is locked.
 *
 * Nothing clinical, and no patient's name: the point of the lock is that the
 * person holding the phone has not proved who they are yet.
 */
struct LockedView: View {
    @Environment(\.colorScheme) private var scheme

    let lock: BiometricLock
    let signOut: () async -> Void

    @State private var failed = false

    var body: some View {
        VStack(spacing: Tokens.Spacing.xl) {
            Spacer()

            Image(systemName: lock.kind == .touchID ? "touchid" : "faceid")
                .font(.system(size: 56))
                .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                .accessibilityHidden(true)

            Text(L10n.string("biometrics.locked"))
                .font(Tokens.Typography.headingRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                .multilineTextAlignment(.center)

            if failed {
                Text(L10n.string("biometrics.tryAgain"))
                    .font(Tokens.Typography.calloutRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    .multilineTextAlignment(.center)
            }

            PrimaryButton(
                title: String(
                    format: L10n.string("biometrics.unlockWith"),
                    lock.kind.localizedName
                ),
                isBusy: false,
                isEnabled: true
            ) {
                failed = !(await lock.unlock())
            }
            .padding(.horizontal, Tokens.Spacing.xl)

            Button(L10n.string("auth.signOut")) { Task { await signOut() } }
                .frame(minHeight: Tokens.minimumTouchTarget)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Tokens.Palette.background.resolve(for: scheme))
        // Asked as soon as the screen appears, so the common case is one glance
        // rather than a glance and a tap.
        .task { failed = !(await lock.unlock()) }
    }
}
