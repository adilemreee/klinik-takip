import SwiftUI

/// Content hints, expressed without naming UIKit types.
///
/// The package builds for macOS as well so its tests run headlessly, and
/// `UITextContentType` does not exist there. Mapping happens behind a platform
/// check in one place rather than at every call site.
public enum FieldPurpose: Sendable {
    case username
    case password
    case oneTimeCode
    case plain
}

public enum FieldKeyboard: Sendable {
    case `default`
    case emailAddress
    case numberPad
}

/// The page frame every auth screen shares: a title, optional explanation, and
/// the content, with generous spacing for readers who scale their text up.
public struct FormScaffold<Content: View>: View {
    @Environment(\.colorScheme) private var scheme

    private let title: String
    private let subtitle: String?
    private let content: Content

    public init(title: String, subtitle: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.content = content()
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                    Text(title)
                        .font(Tokens.Typography.titleRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                        // One heading per screen, so VoiceOver rotor navigation
                        // lands somewhere useful.
                        .accessibilityAddTraits(.isHeader)

                    if let subtitle {
                        Text(subtitle)
                            .font(Tokens.Typography.bodyRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    }
                }

                content
            }
            .padding(Tokens.Spacing.xl)
            .frame(maxWidth: 520, alignment: .leading)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
    }
}

/// A labelled text field.
///
/// The label is a real `Text` above the field rather than a placeholder:
/// placeholder-only fields lose their label the moment someone types, which is
/// exactly when a returning user needs to check what they are filling in.
public struct LabelledField: View {
    @Environment(\.colorScheme) private var scheme

    private let label: String
    @Binding private var text: String
    private let isSecure: Bool
    private let purpose: FieldPurpose
    private let keyboard: FieldKeyboard

    public init(
        label: String,
        text: Binding<String>,
        isSecure: Bool,
        contentType: FieldPurpose,
        keyboard: FieldKeyboard
    ) {
        self.label = label
        self._text = text
        self.isSecure = isSecure
        self.purpose = contentType
        self.keyboard = keyboard
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Text(label)
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            field
                .textFieldStyle(.plain)
                .padding(Tokens.Spacing.md)
                .frame(minHeight: Tokens.minimumTouchTarget)
                .background(Tokens.Palette.surface.resolve(for: scheme))
                .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
                .overlay(
                    RoundedRectangle(cornerRadius: Tokens.Radius.md)
                        .stroke(Tokens.Palette.border.resolve(for: scheme), lineWidth: 1)
                )
                .accessibilityLabel(label)
        }
    }

    @ViewBuilder
    private var field: some View {
        let base = Group {
            if isSecure {
                SecureField("", text: $text)
            } else {
                TextField("", text: $text)
            }
        }

        #if os(iOS)
        base
            .textContentType(purpose.uiContentType)
            .keyboardType(keyboard.uiKeyboardType)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        #else
        base
        #endif
    }
}

/// The main action. Occupies the full width and never shrinks below the
/// minimum touch target (spec section 7).
public struct PrimaryButton: View {
    @Environment(\.colorScheme) private var scheme

    private let title: String
    private let isBusy: Bool
    private let isEnabled: Bool
    private let action: () async -> Void

    public init(
        title: String,
        isBusy: Bool,
        isEnabled: Bool,
        action: @escaping () async -> Void
    ) {
        self.title = title
        self.isBusy = isBusy
        self.isEnabled = isEnabled
        self.action = action
    }

    public var body: some View {
        Button {
            Task { await action() }
        } label: {
            ZStack {
                Text(title)
                    .font(Tokens.Typography.subheadingRelative)
                    // Kept in the layout while busy so the button does not
                    // change size and shift everything under it.
                    .opacity(isBusy ? 0 : 1)

                if isBusy {
                    ProgressView()
                }
            }
            .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
            .foregroundStyle(Tokens.Palette.accentText.resolve(for: scheme))
            .background(
                (isEnabled && !isBusy
                    ? Tokens.Palette.accent
                    : Tokens.Palette.textDisabled).resolve(for: scheme)
            )
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        }
        .disabled(!isEnabled || isBusy)
        .accessibilityLabel(title)
        .accessibilityHint(isBusy ? "" : "")
        .accessibilityAddTraits(isBusy ? .updatesFrequently : [])
    }
}

/// Shows a failure. Carries an icon as well as colour, because a message the
/// reader cannot distinguish by hue is no message at all (spec section 7).
public struct ErrorBanner: View {
    @Environment(\.colorScheme) private var scheme

    private let message: String?
    private let isLockout: Bool

    public init(message: String?, isLockout: Bool = false) {
        self.message = message
        self.isLockout = isLockout
    }

    public var body: some View {
        if let message {
            let state = isLockout ? Tokens.State.triageUrgent : Tokens.State.labCritical

            HStack(alignment: .top, spacing: Tokens.Spacing.sm) {
                Image(systemName: state.iconName)
                    .foregroundStyle(state.color.resolve(for: scheme))

                Text(message)
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(Tokens.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                (isLockout ? Tokens.Palette.warningSurface : Tokens.Palette.criticalSurface)
                    .resolve(for: scheme)
            )
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
            // Announced as soon as it appears rather than waiting for the
            // reader to navigate to it.
            .accessibilityAddTraits(.isStaticText)
            .accessibilityLabel(message)
        }
    }
}

#if os(iOS)
import UIKit

extension FieldPurpose {
    var uiContentType: UITextContentType? {
        switch self {
        case .username: return .username
        case .password: return .password
        case .oneTimeCode: return .oneTimeCode
        case .plain: return nil
        }
    }
}

extension FieldKeyboard {
    var uiKeyboardType: UIKeyboardType {
        switch self {
        case .default: return .default
        case .emailAddress: return .emailAddress
        case .numberPad: return .numberPad
        }
    }
}
#endif
