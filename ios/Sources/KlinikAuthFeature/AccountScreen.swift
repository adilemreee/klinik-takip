import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// Where somebody sees which devices are signed in, and ends the ones that
/// should not be (spec M1).
public struct AccountScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: AccountModel
    private let signOut: () async -> Void
    /// The biometric setting, owned by the shell. Nil on a platform that has
    /// no such thing, which leaves the section out rather than showing a
    /// switch that does nothing.
    private let biometrics: BiometricSetting?

    @State private var state = AccountState()
    @State private var confirmingSignOutEverywhere = false

    public init(
        model: AccountModel,
        signOut: @escaping () async -> Void,
        biometrics: BiometricSetting? = nil
    ) {
        self.model = model
        self.signOut = signOut
        self.biometrics = biometrics
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                ErrorBanner(message: state.error)

                switch state.phase {
                case .loading:
                    VStack(spacing: Tokens.Spacing.lg) {
                        SkeletonCard(lines: 3)
                        SkeletonCard(lines: 3)
                    }
                    .accessibilityElement()
                    .accessibilityLabel(L10n.string("common.loading"))

                case .failed(let message):
                    MessageState(
                        icon: Tokens.State.labCritical.iconName,
                        text: message,
                        retryTitle: L10n.string("common.retry")
                    ) {
                        await reload()
                    }

                case .loaded:
                    security
                    sessions
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("account.title"))
        .refreshable { await reload() }
        .task { await reload() }
        .confirmationDialog(
            L10n.string("account.signOutEverywhereConfirm"),
            isPresented: $confirmingSignOutEverywhere,
            titleVisibility: .visible
        ) {
            Button(L10n.string("account.signOutEverywhere"), role: .destructive) {
                Task {
                    if await model.signOutEverywhere() { await signOut() }
                    state = model.currentState()
                }
            }

            Button(L10n.string("common.cancel"), role: .cancel) {}
        }
    }

    @ViewBuilder
    private var security: some View {
        if let biometrics {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(title: L10n.string("account.security"))

                Card {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                        if biometrics.isAvailable {
                            Toggle(
                                L10n.string("biometrics.enable"),
                                isOn: Binding(
                                    get: { biometrics.isEnabled() },
                                    set: { biometrics.setEnabled($0) }
                                )
                            )
                            .font(Tokens.Typography.bodyRelative)
                            .frame(minHeight: Tokens.minimumTouchTarget)

                            Text(L10n.string("biometrics.enableHint"))
                                .font(Tokens.Typography.captionRelative)
                                .foregroundStyle(
                                    Tokens.Palette.textSecondary.resolve(for: scheme)
                                )
                                .fixedSize(horizontal: false, vertical: true)
                        } else {
                            Text(L10n.string("biometrics.unavailable"))
                                .font(Tokens.Typography.bodyRelative)
                                .foregroundStyle(
                                    Tokens.Palette.textSecondary.resolve(for: scheme)
                                )
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var sessions: some View {
        if let current = state.current {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(title: L10n.string("account.thisDevice"))
                card(current, canRevoke: false)
            }
        }

        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(
                title: L10n.string("account.otherDevices"),
                subtitle: "\(state.others.count)"
            )

            if state.others.isEmpty {
                Card {
                    Text(L10n.string("account.noOtherDevices"))
                        .font(Tokens.Typography.bodyRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }
            } else {
                ForEach(state.others) { session in
                    card(session, canRevoke: true)
                }
            }
        }

        Button(L10n.string("account.signOutEverywhere")) {
            confirmingSignOutEverywhere = true
        }
        .font(Tokens.Typography.calloutRelative)
        .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
        .foregroundStyle(Tokens.Palette.critical.resolve(for: scheme))
    }

    private func card(_ session: DeviceSession, canRevoke: Bool) -> some View {
        Card(tone: session.current ? .info : .neutral) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                HStack(spacing: Tokens.Spacing.md) {
                    Image(systemName: AccountScreen.symbol(for: session.platform))
                        .font(Tokens.Typography.headingRelative)
                        .frame(width: 32)
                        .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                        .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                        Text(session.deviceName ?? L10n.string("account.unknownDevice"))
                            .font(Tokens.Typography.subheadingRelative)
                            .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                        Text(
                            String(
                                format: L10n.string("account.lastSeen"),
                                session.lastSeenAt.formatted(date: .abbreviated, time: .shortened)
                            )
                        )
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    }

                    Spacer(minLength: 0)

                    if session.current {
                        Badge(
                            L10n.string("account.thisDevice"),
                            tone: .info,
                            symbol: "checkmark.circle"
                        )
                    }
                }
                .accessibilityElement(children: .combine)

                // Shown because it is how somebody recognises a session they do
                // not remember. It is the clinic's own record, not a lookup.
                if let ip = session.ipAddress {
                    FieldRow(label: L10n.string("account.address"), value: ip)
                }

                if canRevoke {
                    Button(L10n.string("account.revoke")) {
                        Task {
                            await model.revoke(session.familyId)
                            state = model.currentState()
                        }
                    }
                    .font(Tokens.Typography.calloutRelative)
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.critical.resolve(for: scheme))
                    .disabled(state.busyId != nil)
                }
            }
        }
    }

    static func symbol(for platform: String?) -> String {
        switch platform?.lowercased() {
        case "ios": return "iphone"
        case "android": return "candybarphone"
        case "web": return "desktopcomputer"
        default: return "questionmark.circle"
        }
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}


/**
 * The biometric setting, as this screen needs it.
 *
 * A small struct of closures rather than the lock itself: the account screen
 * lives in the auth feature, the lock lives in the shell, and a feature module
 * that imported the shell would make the dependency graph a circle.
 */
public struct BiometricSetting: Sendable {
    public let isAvailable: Bool
    public let isEnabled: @MainActor @Sendable () -> Bool
    public let setEnabled: @MainActor @Sendable (Bool) -> Void

    public init(
        isAvailable: Bool,
        isEnabled: @escaping @MainActor @Sendable () -> Bool,
        setEnabled: @escaping @MainActor @Sendable (Bool) -> Void
    ) {
        self.isAvailable = isAvailable
        self.isEnabled = isEnabled
        self.setEnabled = setEnabled
    }
}
