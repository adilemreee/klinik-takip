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
                CredentialsView(state: state) { identifier, password in
                    await model.submitCredentials(
                        identifier: identifier,
                        password: password,
                        deviceName: deviceName
                    )
                    await refresh()
                }

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
        }
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
            // The secret in text as well as a code to scan: scanning fails often
            // enough — a cracked screen, a borrowed phone — that leaving only
            // one route in would strand people at onboarding.
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
