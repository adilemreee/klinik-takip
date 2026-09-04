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

    public init(environment: AppEnvironment) {
        self.environment = environment
    }

    public var body: some View {
        content
            .task { await start() }
    }

    @ViewBuilder
    private var content: some View {
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
            LaunchView(failed: identityFailed) { await refreshIdentity() }
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
            signOut: { await signOut() }
        )
    }

    private var staffHome: some View {
        StaffPatientsView(environment: environment, signOut: { await signOut() })
    }

    // MARK: - State

    private func start() async {
        await environment.session.restore()
        await refresh()
    }

    private func refresh() async {
        sessionState = await environment.session.state

        guard sessionState == .signedIn else {
            identity = nil
            return
        }

        await refreshIdentity()
    }

    private func refreshIdentity() async {
        identityFailed = false

        do {
            identity = try await environment.me.identity()
        } catch {
            // Not treated as signed out: a network blip is not a lapsed
            // session, and signing somebody out for one would lose their queued
            // work. The launch screen offers a retry instead.
            identityFailed = true
        }
    }

    private func signOut() async {
        await environment.session.signOut()
        identity = nil
        sessionState = .signedOut
    }
}

/// Shown while the app is still working out who is signed in.
struct LaunchView: View {
    let failed: Bool
    let retry: () async -> Void

    var body: some View {
        VStack(spacing: Tokens.Spacing.lg) {
            if failed {
                Text(L10n.string("app.identityFailed"))
                    .multilineTextAlignment(.center)
                Button(L10n.string("app.retry")) { Task { await retry() } }
                    .buttonStyle(.borderedProminent)
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
