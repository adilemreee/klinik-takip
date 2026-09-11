import SwiftUI
import KlinikCore
import KlinikDesign

/// Hosts the sign-in sequence and shows the screen the flow is currently on.
///
/// The step is a single value, so the view never has to reconcile flags that
/// disagree — there is exactly one screen for each state.
public struct AuthFlowView: View {
    @Environment(\.colorScheme) private var scheme

    private let model: AuthFlowModel
    @State private var state = AuthState()
    private let deviceName: String?
    private let onSignedIn: () -> Void

    public init(model: AuthFlowModel, deviceName: String? = nil, onSignedIn: @escaping () -> Void) {
        self.model = model
        self.deviceName = deviceName
        self.onSignedIn = onSignedIn
    }

    public var body: some View {
        Group {
            switch state.step {
            case .credentials:
                CredentialsView(
                    state: state,
                    submit: { identifier, password in
                        await model.submitCredentials(
                            identifier: identifier,
                            password: password,
                            deviceName: deviceName
                        )
                        await refresh()
                    },
                    openInvitation: {
                        Task {
                            await model.showInvitation()
                            await refresh()
                        }
                    }
                )

            case .invitation:
                InvitationView(
                    state: state,
                    submit: { identifier, code, password in
                        await model.redeemInvitation(
                            identifier: identifier,
                            code: code,
                            password: password,
                            deviceName: deviceName
                        )
                        await refresh()
                    },
                    cancel: {
                        Task {
                            await model.cancelInvitation()
                            await refresh()
                        }
                    }
                )

            case .twoFactorCode:
                TwoFactorCodeView(state: state) { code in
                    await model.submitTwoFactorCode(code)
                    await refresh()
                }

            case .twoFactorSetup(let secret, let uri):
                TwoFactorSetupView(state: state, secret: secret, otpauthURI: uri) { code in
                    await model.confirmTwoFactorSetup(code: code)
                    await refresh()
                }

            case .signedIn:
                Color.clear.onAppear(perform: onSignedIn)
            }
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
    }

    private func refresh() async {
        state = await model.currentState()
    }
}

/// Step one: who you are and your password.
struct CredentialsView: View {
    @Environment(\.colorScheme) private var scheme

    let state: AuthState
    let submit: (String, String) async -> Void
    /// The way in for somebody who has a code and no account yet.
    let openInvitation: () -> Void

    @State private var identifier = ""
    @State private var password = ""

    var body: some View {
        FormScaffold(title: L10n.string("auth.signIn")) {
            LabelledField(
                label: L10n.string("auth.identifier"),
                text: $identifier,
                isSecure: false,
                contentType: .username,
                keyboard: .emailAddress
            )

            LabelledField(
                label: L10n.string("auth.password"),
                text: $password,
                isSecure: true,
                contentType: .password,
                keyboard: .default
            )

            ErrorBanner(message: state.errorMessage, isLockout: state.isLockedOut)

            PrimaryButton(
                title: L10n.string("auth.signIn"),
                isBusy: state.isSubmitting,
                // Disabled only for empty input. A locked account still submits,
                // so the user gets the same explanation rather than a dead button
                // with no reason attached.
                isEnabled: !identifier.isEmpty && !password.isEmpty
            ) {
                await submit(identifier, password)
            }

            // Under the sign-in button, not beside it: almost everybody
            // opening this screen already has an account, and a first-run
            // form competing with the ordinary one helps nobody.
            Button(L10n.string("auth.haveInvitation"), action: openInvitation)
                .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
        }
    }
}

/**
 * Redeeming an invitation: who you are, the code, and a password you choose.
 *
 * The password rules are shown as they are broken rather than after the
 * server refuses: a rejection arriving from the network, on a form somebody
 * has just filled in, reads as the app being broken.
 */
struct InvitationView: View {
    @Environment(\.colorScheme) private var scheme

    let state: AuthState
    let submit: (String, String, String) async -> Void
    let cancel: () -> Void

    @State private var identifier = ""
    @State private var code = ""
    @State private var password = ""

    private var problems: [String] {
        password.isEmpty ? [] : PasswordRules.problems(with: password, identifier: identifier)
    }

    private var canSubmit: Bool {
        !identifier.isEmpty
            && code.count == InvitationView.codeLength
            && problems.isEmpty
            && !password.isEmpty
    }

    var body: some View {
        FormScaffold(title: L10n.string("auth.invitationTitle")) {
            Text(L10n.string("auth.invitationHint"))
                .font(Tokens.Typography.calloutRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                .fixedSize(horizontal: false, vertical: true)

            LabelledField(
                label: L10n.string("auth.identifier"),
                text: $identifier,
                isSecure: false,
                contentType: .username,
                keyboard: .emailAddress
            )

            LabelledField(
                label: L10n.string("auth.invitationCode"),
                text: $code,
                isSecure: false,
                contentType: .oneTimeCode,
                keyboard: .numberPad
            )

            LabelledField(
                label: L10n.string("auth.choosePassword"),
                text: $password,
                isSecure: true,
                contentType: .newPassword,
                keyboard: .default
            )

            PasswordRuleList(problems: problems, showAll: password.isEmpty)

            ErrorBanner(message: state.errorMessage, isLockout: state.isLockedOut)

            PrimaryButton(
                title: L10n.string("auth.invitationAction"),
                isBusy: state.isSubmitting,
                isEnabled: canSubmit
            ) {
                await submit(identifier, code, password)
            }

            Button(L10n.string("common.cancel"), action: cancel)
                .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
        }
    }

    /// Six digits, matching the server's `@Length(6, 6)`.
    ///
    /// `nonisolated` because a static on a `View` otherwise inherits the view's
    /// main-actor isolation, and the tests read it directly.
    nonisolated static let codeLength = 6
}

/**
 * What is wrong with the password, or what is being asked for.
 *
 * Before anything is typed it reads as a list of requirements; afterwards only
 * the unmet ones stay. Telling somebody a rule they have already satisfied is
 * noise, and noise is what makes people stop reading the list.
 */
struct PasswordRuleList: View {
    @Environment(\.colorScheme) private var scheme

    let problems: [String]
    let showAll: Bool

    var body: some View {
        if showAll {
            rules(PasswordRules.problems(with: "", identifier: ""), tone: .neutral)
        } else if !problems.isEmpty {
            rules(problems, tone: .warning)
        }
    }

    private func rules(_ lines: [String], tone: Tone) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
            ForEach(lines, id: \.self) { line in
                Text("• \(line)")
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(tone.foreground.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// Step two when the account already has a second factor.
struct TwoFactorCodeView: View {
    let state: AuthState
    let submit: (String) async -> Void

    @State private var code = ""

    var body: some View {
        FormScaffold(
            title: L10n.string("auth.twoFactorTitle"),
            subtitle: L10n.string("auth.twoFactorHint")
        ) {
            LabelledField(
                label: L10n.string("auth.twoFactorTitle"),
                text: $code,
                isSecure: false,
                contentType: .oneTimeCode,
                keyboard: .numberPad
            )

            ErrorBanner(message: state.errorMessage, isLockout: state.isLockedOut)

            PrimaryButton(
                title: L10n.string("common.done"),
                isBusy: state.isSubmitting,
                isEnabled: code.count == 6
            ) {
                await submit(code)
            }
        }
    }
}

/// Staff enrolling a second factor before their first sign-in.
struct TwoFactorSetupView: View {
    @Environment(\.colorScheme) private var scheme

    let state: AuthState
    let secret: String
    let otpauthURI: String
    let submit: (String) async -> Void

    @State private var code = ""

    var body: some View {
        FormScaffold(
            title: L10n.string("auth.twoFactorSetupTitle"),
            subtitle: L10n.string("auth.twoFactorSetupHint")
        ) {
            // Both routes in. Scanning fails often enough — a cracked screen,
            // a borrowed phone, an authenticator with no camera permission —
            // that offering only one would strand people at onboarding.
            HStack {
                Spacer()
                QRCode(payload: otpauthURI)
                Spacer()
            }

            Text(L10n.string("auth.twoFactorTypeInstead"))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            Text(secret)
                .font(.system(.body, design: .monospaced))
                .textSelection(.enabled)
                .padding(Tokens.Spacing.md)
                .frame(maxWidth: .infinity)
                .background(Tokens.Palette.surface.resolve(for: scheme))
                .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
                .accessibilityLabel(secret.map(String.init).joined(separator: " "))

            LabelledField(
                label: L10n.string("auth.twoFactorTitle"),
                text: $code,
                isSecure: false,
                contentType: .oneTimeCode,
                keyboard: .numberPad
            )

            ErrorBanner(message: state.errorMessage, isLockout: state.isLockedOut)

            PrimaryButton(
                title: L10n.string("common.done"),
                isBusy: state.isSubmitting,
                isEnabled: code.count == 6
            ) {
                await submit(code)
            }
        }
    }
}
