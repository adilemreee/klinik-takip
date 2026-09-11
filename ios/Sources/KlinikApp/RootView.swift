import SwiftUI
import KlinikAPI
import KlinikAuthFeature
import KlinikCore
import KlinikDesign
import KlinikHomeFeature
import KlinikPatientsFeature

/**
 * The screen the app opens on (T2.3–T2.5).
 *
 * Everything it does is decided by `Root.route`, which is tested on its own.
 * What is left here is what a shell should be: asking the session what it
 * knows, asking the server who that is, and putting the right screen on
 * screen.
 */
@MainActor
public struct RootView: View {
    private let environment: AppEnvironment

    @State private var sessionState: SessionState = .signedOut
    @State private var identity: Identity?
    @State private var identityFailed = false
    @State private var lock = BiometricLock()
    @State private var push: PushRegistrar?
    /// True while iOS is showing a prompt this app asked for. See the cover.
    @State private var askingPermission = false

    @Environment(\.scenePhase) private var scenePhase

    public init(environment: AppEnvironment) {
        self.environment = environment
    }

    public var body: some View {
        VStack(spacing: 0) {
            // Above everything and on every screen, because the spec asks for
            // the offline state to be designed into all of them (section 7) and
            // one bar in the shell is how that stays true of screens nobody has
            // written yet.
            FreshnessBanner(freshness: environment.connection.freshness)

            content
        }
        // Over everything, including the lock screen: iOS takes the app
        // switcher's picture as the app goes inactive, and a card showing
        // somebody's lab results is a leak to whoever is holding the phone
        // next — no exploit required.
        .overlay {
            PrivacyCover(
                hidden: scenePhase == .active
                    || sessionState != .signedIn
                    // A system prompt this app asked for — Face ID, the push
                    // permission — makes the app inactive without putting it
                    // away. Covering for those flashes the shield over a
                    // dialog the person is looking at.
                    || lock.isPrompting
                    || askingPermission
            )
        }
        .task { await start() }
        .task {
            // The session, for as long as the app is up. Read once at launch it
            // would never show the moment a session lapses: every request would
            // fail behind whatever screen was open, with no way back to sign-in.
            for await state in await environment.session.updates() {
                await apply(state)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                lock.wentAway()

            case .active:
                lock.cameBack()

                // Coming back to the front is the moment a patient has most
                // likely walked into signal. Cheaper and more accurate than a
                // timer.
                Task { await environment.sync.sync() }

            default:
                break
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        // Ahead of the route, not inside it: the lock is about who is holding
        // the phone, which is a question that comes before which screen they
        // are entitled to.
        if lock.isLocked, sessionState == .signedIn {
            LockedView(lock: lock, signOut: { await signOut() })
        } else {
            routed
        }
    }

    @ViewBuilder
    private var routed: some View {
        switch Root.route(for: RootInput(session: sessionState, identity: identity)) {
        case .signIn:
            authFlow(message: nil)

        case .signInAgain:
            authFlow(message: L10n.string("auth.sessionExpired"))

        case .patientHome(let patientId):
            patientHome(patientId: patientId)

        case .staffHome:
            staffHome

        case .unsupported(let role):
            UnsupportedRoleView(role: role) { await signOut() }

        case nil:
            // Still asking who this is. Not a spinner over a login form: that
            // would flash sign-in at somebody already signed in, every launch.
            LaunchView(
                failed: identityFailed,
                retry: { await refreshIdentity() },
                signOut: { await signOut() }
            )
        }
    }

    private func authFlow(message: String?) -> some View {
        AuthFlowView(
            model: AuthFlowModel(auth: environment.auth, session: environment.session),
            onSignedIn: { Task { await refresh() } }
        )
        .overlay(alignment: .top) {
            if let message {
                Text(message)
                    .font(.footnote)
                    .padding(Tokens.Spacing.md)
            }
        }
    }

    private func patientHome(patientId: String?) -> some View {
        PatientHomeView(
            environment: environment,
            patientId: patientId,
            signOut: { await signOut() },
            biometrics: biometricSetting
        )
    }

    private var staffHome: some View {
        StaffPatientsView(
            environment: environment,
            signOut: { await signOut() },
            biometrics: biometricSetting
        )
    }

    /// The lock, as the account screen needs it: three closures rather than the
    /// object, so a feature module never imports the shell.
    private var biometricSetting: BiometricSetting {
        BiometricSetting(
            isAvailable: lock.isAvailable,
            isEnabled: { [lock] in lock.isEnabled },
            setEnabled: { [lock] enabled in lock.setEnabled(enabled) }
        )
    }

    // MARK: - State

    private func start() async {
        environment.sync.start()
        // Publishes into the stream above, which is what routes the app.
        await environment.session.restore()
    }

    /**
     * A session change, applied.
     *
     * The only place `sessionState` is written, so the screen on show and the
     * session can never disagree. Identity is fetched when a session appears
     * and dropped when one ends — a stale identity outliving a sign-out would
     * route the next person to the last one's home screen.
     */
    private func apply(_ state: SessionState) async {
        let wasSignedIn = sessionState == .signedIn
        sessionState = state

        guard state == .signedIn else {
            identity = nil
            identityFailed = false

            // A session that lapsed while the app was open leaves a socket and
            // a push registration belonging to somebody who is no longer here.
            if wasSignedIn {
                await endSideEffects()
            }

            return
        }

        guard identity == nil else { return }

        await refreshIdentity()
    }

    private func refresh() async {
        await apply(await environment.session.state)
    }

    /// Push registration waits for a signed-in session: the token is stored
    /// against a user, and asking iOS for permission before somebody knows what
    /// the app is gets refused — and iOS only asks once.
    private func startPush() async {
        guard push == nil else { return }

        let registrar = PushRegistrar(
            notifications: environment.notifications,
            medications: environment.medications
        )
        push = registrar
        PushTokenBridge.shared.registrar = registrar

        askingPermission = true
        await registrar.start()
        askingPermission = false
    }

    private func refreshIdentity() async {
        identityFailed = false

        do {
            identity = try await environment.me.identity()
            await startPush()
            // After identity, like push: the socket authenticates as somebody,
            // and opening it before we know who would be a connection nobody
            // could scope.
            await environment.live.start()
        } catch let error as APIError where error.requiresReauthentication {
            // The server has judged this session: revoked, locked, or gone.
            // Offering a retry button would be offering to be refused again.
            await signOut()
        } catch {
            // Not treated as signed out: a network blip is not a lapsed
            // session, and signing somebody out for one would lose their queued
            // work. The launch screen offers a retry instead.
            identityFailed = true
        }
    }

    private func signOut() async {
        // Before the session ends, while the token can still be revoked with a
        // valid credential.
        await endSideEffects()

        await environment.session.signOut()
        // The cache holds one person's clinical record. Left behind, the next
        // account on this device would be shown it the first time the network
        // dropped.
        await environment.client.forgetCachedResponses()
        // And the queue holds one person's unsent writes, addressed to `me/…`.
        // Left behind, they would be sent as whoever signs in next.
        await environment.sync.clearForSignOut()
        identity = nil
        identityFailed = false
        // `signOut` publishes, so `apply` sets this too — done here as well so
        // the screen changes in the same frame as the tap.
        sessionState = .signedOut
    }

    /// Everything holding the session open besides the tokens themselves.
    private func endSideEffects() async {
        await push?.stop()
        push = nil
        PushTokenBridge.shared.registrar = nil

        // A socket authenticated as one person must not still be delivering
        // when the next one signs in.
        environment.live.stop()
    }
}

/// Shown while the app is still working out who is signed in.
struct LaunchView: View {
    let failed: Bool
    let retry: () async -> Void
    /// The way out. Without it a session the server keeps refusing leaves the
    /// app on this screen with a retry button and nothing else — which is not
    /// a loading state, it is a locked door.
    let signOut: () async -> Void

    var body: some View {
        VStack(spacing: Tokens.Spacing.lg) {
            if failed {
                Text(L10n.string("app.identityFailed"))
                    .multilineTextAlignment(.center)
                Button(L10n.string("app.retry")) { Task { await retry() } }
                    .buttonStyle(.borderedProminent)
                    .frame(minHeight: Tokens.minimumTouchTarget)
                Button(L10n.string("auth.signOut")) { Task { await signOut() } }
                    .frame(minHeight: Tokens.minimumTouchTarget)
            } else {
                ProgressView()
                    .accessibilityLabel(L10n.string("app.starting"))
            }
        }
        .padding(Tokens.Spacing.xl)
    }
}

/**
 * A signed-in account this app has no home for.
 *
 * Says so and offers a way out, rather than showing somebody a screen that is
 * not theirs — which is what routing a caregiver to a patient home would do.
 */
struct UnsupportedRoleView: View {
    let role: UserRole
    let signOut: () async -> Void

    var body: some View {
        VStack(spacing: Tokens.Spacing.lg) {
            Text(L10n.string("app.roleUnsupported"))
                .multilineTextAlignment(.center)
            Text(role.localizedName)
                .font(.footnote)
            Button(L10n.string("auth.signOut")) { Task { await signOut() } }
        }
        .padding(Tokens.Spacing.xl)
    }
}


/**
 * What the app switcher is allowed to photograph.
 *
 * iOS snapshots the screen as the app goes inactive and shows that picture on
 * the multitasking card. Without this, the card is whatever was open — a
 * patient's file, a lab value, a wound photograph — visible to anyone holding
 * the phone, with nothing to break into.
 *
 * Shown whenever the app is not frontmost and somebody is signed in, whether
 * or not the device lock is switched on: the two protect different things, and
 * a patient on their own phone still has a right not to have their results in
 * the app switcher.
 */
struct PrivacyCover: View {
    @Environment(\.colorScheme) private var scheme

    let hidden: Bool

    var body: some View {
        if hidden {
            EmptyView()
        } else {
            ZStack {
                Tokens.Palette.background.resolve(for: scheme)

                VStack(spacing: Tokens.Spacing.md) {
                    Image(systemName: "cross.case.fill")
                        .font(.system(size: 44))
                        .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                        // The name below says it.
                        .accessibilityHidden(true)

                    Text(L10n.string("app.name"))
                        .font(Tokens.Typography.headingRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                }
            }
            .ignoresSafeArea()
            .transition(.opacity)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(L10n.string("app.name"))
        }
    }
}
