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

    /**
     * Whether this account may turn its second factor off.
     *
     * False for clinic staff, for whom it is mandatory — the server refuses,
     * and a button that always fails is worse than no button. Passed in
     * because the shell knows the role and this screen does not.
     */
    private let canDisableTwoFactor: Bool

    /**
     * Producing the patient's own copy of their record (KVKK m.11).
     *
     * A closure returning the file, because writing it and presenting a share
     * sheet is the shell's business and fetching it is the API's. Nil for
     * staff: `me/data-export` is a patient's own record and there is none.
     */
    private let exportMyData: (() async -> URL?)?

    @State private var state = AccountState()
    @State private var confirmingSignOutEverywhere = false
    @State private var changingPassword = false
    @State private var disablingTwoFactor = false
    @State private var twoFactorOff = false
    @State private var exporting = false
    @State private var exported: URL?
    @State private var exportFailed = false

    public init(
        model: AccountModel,
        signOut: @escaping () async -> Void,
        biometrics: BiometricSetting? = nil,
        canDisableTwoFactor: Bool = false,
        exportMyData: (() async -> URL?)? = nil
    ) {
        self.model = model
        self.signOut = signOut
        self.biometrics = biometrics
        self.canDisableTwoFactor = canDisableTwoFactor
        self.exportMyData = exportMyData
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
                    credentials
                    myData
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
        .sheet(isPresented: $changingPassword) {
            ChangePasswordSheet { current, next in
                let changed = await model.changePassword(current: current, new: next)
                state = model.currentState()

                return changed
            } finished: {
                // Every session is dead, this one included. Staying would be a
                // screen where nothing works and nothing says why.
                changingPassword = false
                Task { await signOut() }
            }
        }
        .sheet(isPresented: $disablingTwoFactor) {
            DisableTwoFactorSheet { code in
                let disabled = await model.disableTwoFactor(code: code)
                state = model.currentState()

                if disabled {
                    twoFactorOff = true
                    disablingTwoFactor = false
                }

                return disabled
            }
        }
    }

    /**
     * The patient's own copy of their record (KVKK m.11).
     *
     * A right the privacy notice promises in writing, which until now had
     * nothing behind it in the app. Produced on demand and handed to the share
     * sheet rather than saved somewhere: it is the reader's file, and where it
     * goes is their decision.
     */
    @ViewBuilder
    private var myData: some View {
        if let exportMyData {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(title: L10n.string("dataExport.title"))

                Card {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                        Text(L10n.string("dataExport.explain"))
                            .font(Tokens.Typography.calloutRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                            .fixedSize(horizontal: false, vertical: true)

                        if let exported {
                            ShareLink(item: exported) {
                                Label(
                                    L10n.string("dataExport.share"),
                                    systemImage: "square.and.arrow.up"
                                )
                                .font(Tokens.Typography.bodyRelative)
                                .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                            }
                            .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                        } else {
                            PrimaryButton(
                                title: L10n.string("dataExport.prepare"),
                                isBusy: exporting,
                                isEnabled: !exporting
                            ) {
                                exporting = true
                                exportFailed = false
                                exported = await exportMyData()
                                exportFailed = exported == nil
                                exporting = false
                            }
                        }

                        if exportFailed {
                            Text(L10n.string("dataExport.failed"))
                                .font(Tokens.Typography.captionRelative)
                                .foregroundStyle(Tone.critical.foreground.resolve(for: scheme))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    /// Password and second factor — the two things about the account itself
    /// rather than about the devices it is signed in on.
    @ViewBuilder
    private var credentials: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(title: L10n.string("account.security"))

            Card {
                VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                    Button(L10n.string("account.changePassword")) { changingPassword = true }
                        .font(Tokens.Typography.bodyRelative)
                        .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget,
                               alignment: .leading)
                        .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))

                    Text(L10n.string("account.changePasswordHint"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            twoFactor
        }
    }

    @ViewBuilder
    private var twoFactor: some View {
        Card {
            VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                HStack {
                    Text(L10n.string("account.twoFactor"))
                        .font(Tokens.Typography.bodyRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                    Spacer(minLength: Tokens.Spacing.sm)

                    Badge(
                        L10n.string(twoFactorOff ? "common.off" : "account.twoFactorOn"),
                        tone: twoFactorOff ? .neutral : .success
                    )
                }

                if !canDisableTwoFactor {
                    // Said rather than hidden: a clinician who goes looking for
                    // this switch should find the reason, not an absence.
                    Text(L10n.string("account.twoFactorMandatory"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                } else if twoFactorOff {
                    Text(L10n.string("account.twoFactorDisabled"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Button(L10n.string("account.disableTwoFactor")) { disablingTwoFactor = true }
                        .font(Tokens.Typography.bodyRelative)
                        .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget,
                               alignment: .leading)
                        .foregroundStyle(Tone.critical.foreground.resolve(for: scheme))
                }
            }
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

/**
 * Changing the password.
 *
 * Confirmed twice, because the field is masked and a typo here locks somebody
 * out of their own clinical record until the clinic resets it by hand. The
 * rules are shown as they are broken rather than after the server refuses.
 */
struct ChangePasswordSheet: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    /// Returns true when the server accepted it.
    let change: (String, String) async -> Bool
    /// Called after the reader has read what happens next.
    let finished: () -> Void

    @State private var current = ""
    @State private var next = ""
    @State private var confirmation = ""
    @State private var busy = false
    @State private var done = false

    private var problems: [String] {
        next.isEmpty ? [] : PasswordRules.problems(with: next)
    }

    private var mismatched: Bool {
        !confirmation.isEmpty && confirmation != next
    }

    private var canSubmit: Bool {
        !current.isEmpty && !next.isEmpty && confirmation == next && problems.isEmpty && !busy
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                    if done {
                        Card(tone: .success) {
                            Text(L10n.string("account.passwordChanged"))
                                .font(Tokens.Typography.bodyRelative)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        PrimaryButton(
                            title: L10n.string("common.close"),
                            isBusy: false,
                            isEnabled: true
                        ) {
                            finished()
                        }
                    } else {
                        form
                    }
                }
                .padding(Tokens.Spacing.lg)
            }
            .background(Tokens.Palette.background.resolve(for: scheme))
            .navigationTitle(L10n.string("account.changePassword"))
            .toolbar {
                if !done {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(L10n.string("common.cancel")) { dismiss() }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var form: some View {
        Text(L10n.string("account.changePasswordHint"))
            .font(Tokens.Typography.calloutRelative)
            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            .fixedSize(horizontal: false, vertical: true)

        LabelledField(
            label: L10n.string("account.currentPassword"),
            text: $current,
            isSecure: true,
            contentType: .password,
            keyboard: .default
        )

        LabelledField(
            label: L10n.string("account.newPassword"),
            text: $next,
            isSecure: true,
            contentType: .newPassword,
            keyboard: .default
        )

        LabelledField(
            label: L10n.string("auth.confirmPassword"),
            text: $confirmation,
            isSecure: true,
            contentType: .newPassword,
            keyboard: .default
        )

        if mismatched {
            Text(L10n.string("auth.passwordsDiffer"))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tone.critical.foreground.resolve(for: scheme))
        }

        PasswordRuleList(problems: problems, showAll: next.isEmpty)

        PrimaryButton(
            title: L10n.string("account.changePassword"),
            isBusy: busy,
            isEnabled: canSubmit
        ) {
            busy = true
            done = await change(current, next)
            busy = false
        }
    }
}

/**
 * Turning the second factor off.
 *
 * A current code is required, so somebody who has the phone in their hand can
 * do it and somebody who merely has the password cannot.
 */
struct DisableTwoFactorSheet: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    let disable: (String) async -> Bool

    @State private var code = ""
    @State private var busy = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                    Text(L10n.string("account.disableTwoFactorHint"))
                        .font(Tokens.Typography.calloutRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)

                    LabelledField(
                        label: L10n.string("account.twoFactorCode"),
                        text: $code,
                        isSecure: false,
                        contentType: .oneTimeCode,
                        keyboard: .numberPad
                    )

                    PrimaryButton(
                        title: L10n.string("account.disableTwoFactor"),
                        isBusy: busy,
                        isEnabled: code.count == DisableTwoFactorSheet.codeLength && !busy
                    ) {
                        busy = true
                        _ = await disable(code)
                        busy = false
                    }
                }
                .padding(Tokens.Spacing.lg)
            }
            .background(Tokens.Palette.background.resolve(for: scheme))
            .navigationTitle(L10n.string("account.disableTwoFactor"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.string("common.cancel")) { dismiss() }
                }
            }
        }
    }

    /// Six digits, as every TOTP code is. `nonisolated` because a static on a
    /// `View` otherwise inherits the view's main-actor isolation.
    nonisolated static let codeLength = 6
}
