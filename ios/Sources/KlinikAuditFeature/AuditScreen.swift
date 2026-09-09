import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * Who looked at what (spec M13).
 *
 * The anomalies sit at the top because they are the half nobody would find by
 * scrolling: two hundred files opened in a night, access at four in the
 * morning, a run of failed sign-ins. Their wording is the server's — it knows
 * what it counted and over what window, and this screen does not.
 *
 * The trail underneath is deliberately plain. It is a record, read rarely and
 * usually because something has gone wrong, and the useful thing is that every
 * row says the same things in the same order.
 */
public struct AuditScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: AuditModel

    @State private var state = AuditState()

    public init(model: AuditModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                switch state.phase {
                case .loading:
                    VStack(spacing: Tokens.Spacing.lg) {
                        SkeletonCard(lines: 3)
                        SkeletonCard(lines: 4)
                    }
                    .accessibilityElement()
                    .accessibilityLabel(L10n.string("common.loading"))

                case .notPermitted:
                    MessageState(icon: "lock", text: L10n.string("audit.notPermitted"))
                        .frame(minHeight: 280)

                case .failed(let message):
                    MessageState(
                        icon: Tokens.State.labCritical.iconName,
                        text: message,
                        retryTitle: L10n.string("common.retry")
                    ) {
                        await reload()
                    }

                case .empty:
                    filters
                    MessageState(icon: "list.bullet.rectangle", text: L10n.string("audit.empty"))
                        .frame(minHeight: 240)

                case .loaded:
                    anomalies
                    filters
                    trail
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("audit.title"))
        .refreshable { await reload() }
        .task { await reload() }
    }

    @ViewBuilder
    private var anomalies: some View {
        if !state.anomalies.isEmpty {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(
                    title: L10n.string("audit.anomalies"),
                    subtitle: L10n.string("audit.anomaliesHint")
                )

                ForEach(state.anomalies) { anomaly in
                    Card(tone: .warning) {
                        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                            HStack(spacing: Tokens.Spacing.sm) {
                                Badge(
                                    anomaly.localizedKind,
                                    tone: .warning,
                                    symbol: "eye.trianglebadge.exclamationmark"
                                )

                                Spacer(minLength: Tokens.Spacing.sm)

                                Badge("\(anomaly.count)")
                            }

                            Text(anomaly.detail)
                                .font(Tokens.Typography.bodyRelative)
                                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                                .fixedSize(horizontal: false, vertical: true)

                            Text(
                                "\(anomaly.windowStart.formatted(date: .abbreviated, time: .shortened)) – \(anomaly.windowEnd.formatted(date: .omitted, time: .shortened))"
                            )
                            .font(Tokens.Typography.captionRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        }
                    }
                }
            }
        }
    }

    private var filters: some View {
        Picker(L10n.string("audit.action"), selection: actionBinding) {
            Text(L10n.string("audit.allActions")).tag(AuditAction?.none)

            ForEach(AuditAction.allCases) { action in
                Text(action.localizedName).tag(AuditAction?.some(action))
            }
        }
        .pickerStyle(.menu)
        .frame(minHeight: Tokens.minimumTouchTarget)
        .accessibilityLabel(L10n.string("audit.action"))
    }

    private var actionBinding: Binding<AuditAction?> {
        Binding(
            get: { state.filter.action },
            set: { action in
                Task {
                    await model.filter(by: action)
                    state = model.currentState()
                }
            }
        )
    }

    private var trail: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            SectionHeader(title: L10n.string("audit.trail"))

            Card {
                VStack(spacing: 0) {
                    ForEach(Array(state.entries.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { Divider() }

                        row(entry)
                    }
                }
            }

            if state.hasMore {
                Button(L10n.string("finance.loadMore")) {
                    Task {
                        await model.loadMore()
                        state = model.currentState()
                    }
                }
                .font(Tokens.Typography.calloutRelative)
                .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
            }
        }
    }

    private func row(_ entry: AuditEntry) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            HStack(spacing: Tokens.Spacing.sm) {
                // Notable actions carry a tint *and* their own name, which is
                // the word a reader is scanning for anyway.
                Badge(
                    entry.action.localizedName,
                    tone: entry.action.isNotable ? .warning : .neutral,
                    symbol: AuditScreen.symbol(for: entry.action)
                )

                Text(entry.localizedEntity)
                    .font(Tokens.Typography.calloutRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                Spacer(minLength: Tokens.Spacing.sm)

                Text(entry.createdAt.formatted(date: .abbreviated, time: .shortened))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }

            HStack(spacing: Tokens.Spacing.sm) {
                Text(entry.localizedRole ?? L10n.string("audit.anonymous"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                if let ip = entry.ipAddress {
                    Text(ip)
                        .font(Tokens.Typography.footnoteRelative)
                        .foregroundStyle(Tokens.Palette.textDisabled.resolve(for: scheme))
                }

                Spacer(minLength: 0)
            }
        }
        .padding(.vertical, Tokens.Spacing.sm)
        .frame(minHeight: Tokens.minimumTouchTarget, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    static func symbol(for action: AuditAction) -> String {
        switch action {
        case .create: return "plus.circle"
        case .read: return "eye"
        case .update: return "pencil"
        case .delete: return "trash"
        case .login: return "arrow.right.circle"
        case .loginFailed: return "xmark.circle"
        case .logout: return "arrow.left.circle"
        case .export: return "square.and.arrow.up"
        case .permissionChange: return "key"
        case .emergencyAccess: return Tokens.State.triageEmergency.iconName
        }
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}
