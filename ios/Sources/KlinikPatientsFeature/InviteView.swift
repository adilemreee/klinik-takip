import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// Giving a patient a way into the app (spec M1).
public struct InviteView: View {
    @Environment(\.colorScheme) private var scheme

    private let model: InviteModel
    private let patientName: String

    @State private var state = InviteState()
    @State private var email = ""
    @State private var phone = ""

    public init(model: InviteModel, patientName: String) {
        self.model = model
        self.patientName = patientName
    }

    public var body: some View {
        FormScaffold(title: L10n.string("invite.title"), subtitle: patientName) {
            switch state.phase {
            case .issued(let invitation):
                issued(invitation)

            case .editing, .sending, .failed:
                form
            }
        }
        .navigationTitle(L10n.string("invite.title"))
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
            Text(L10n.string("invite.hint"))
                .font(Tokens.Typography.calloutRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                .fixedSize(horizontal: false, vertical: true)

            LabelledField(
                label: L10n.string("file.email"),
                text: $email,
                isSecure: false,
                contentType: .username,
                keyboard: .emailAddress
            )

            LabelledField(
                label: L10n.string("file.phone"),
                text: $phone,
                isSecure: false,
                contentType: .plain,
                keyboard: .numberPad
            )

            if case .failed(let message) = state.phase {
                ErrorBanner(message: message)
            }

            PrimaryButton(
                title: L10n.string("invite.action"),
                isBusy: state.phase == .sending,
                isEnabled: state.phase != .sending
            ) {
                await model.invite(email: email, phone: phone)
                state = model.currentState()
            }
        }
    }

    /**
     * The code, once.
     *
     * The server keeps only a hash of it, so this screen is the only place it
     * will ever exist. That is why it is large, selectable, and sits under a
     * sentence saying it will not be shown again — a clinician who taps back
     * without reading it has to issue a new invitation.
     */
    private func issued(_ invitation: Invitation) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
            Card(tone: .success) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                    HStack(spacing: Tokens.Spacing.sm) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(Tokens.Typography.headingRelative)
                            .foregroundStyle(Tokens.Palette.success.resolve(for: scheme))
                            .accessibilityHidden(true)

                        Text(L10n.string("invite.issued"))
                            .font(Tokens.Typography.subheadingRelative)
                            .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                    }

                    Text(invitation.code)
                        .font(.system(.largeTitle, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity)
                        .padding(Tokens.Spacing.lg)
                        .background(Tokens.Palette.surfaceRaised.resolve(for: scheme))
                        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
                        // Read out one character at a time; a reader that says
                        // "eight hundred and forty-two" is no use over a phone.
                        .accessibilityLabel(
                            invitation.code.map(String.init).joined(separator: " ")
                        )

                    Text(L10n.string("invite.shownOnce"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.critical.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)

                    FieldRow(
                        label: L10n.string("invite.expires"),
                        value: invitation.expiresAt.formatted(date: .abbreviated, time: .shortened)
                    )
                }
            }

            ShareLink(item: invitation.code) {
                Label(L10n.string("invite.share"), systemImage: "square.and.arrow.up")
                    .font(Tokens.Typography.subheadingRelative)
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.accentText.resolve(for: scheme))
                    .background(Tokens.Palette.accent.resolve(for: scheme))
                    .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
            }
        }
    }
}
