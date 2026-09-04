import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// Notification preferences and what was actually delivered (spec M6).
public struct NotificationSettingsScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: NotificationSettingsModel

    @State private var state = NotificationSettingsState()

    public init(model: NotificationSettingsModel) {
        self.model = model
    }

    /**
     * The channels a person can turn off.
     *
     * `inApp` is deliberately absent: it is the app's own list, it costs
     * nothing, and a switch that silences the record of what the clinic sent
     * would leave somebody with no way to find out what they missed.
     */
    private static let switchableChannels: [NotificationChannel] = [
        .push, .sms, .email, .whatsapp,
    ]

    public var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("notification.settingsTitle"))
        .task { await refresh { await model.load() } }
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .loading:
            Spacer()
            ProgressView().accessibilityLabel(L10n.string("common.loading"))
            Spacer()

        case .failed(let message):
            MessageState(
                icon: Tokens.State.labCritical.iconName,
                text: message,
                retryTitle: L10n.string("common.retry")
            ) {
                await refresh { await model.load() }
            }

        case .loaded:
            loaded
        }
    }

    private var loaded: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                if let error = state.error {
                    ErrorBanner(message: error)
                }

                // Says plainly that turning a channel off does not mean silence:
                // the server falls back to another one for anything clinical.
                Text(L10n.string("notification.fallbackNote"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                ForEach(NotificationKind.allCases, id: \.rawValue) { kind in
                    PreferenceSection(
                        kind: kind,
                        channels: NotificationSettingsScreen.switchableChannels,
                        state: state
                    ) { channel, enabled in
                        await refresh {
                            await model.set(kind, channel: channel, enabled: enabled)
                        }
                    }
                }

                Divider()

                Text(L10n.string("notification.historyTitle"))
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                if state.history.isEmpty {
                    Text(L10n.string("notification.historyEmpty"))
                        .font(Tokens.Typography.bodyRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                } else {
                    ForEach(state.history) { delivery in
                        DeliveryRow(delivery: delivery)
                    }
                }
            }
            .padding(Tokens.Spacing.lg)
        }
    }

    private func refresh(_ work: () async -> Void) async {
        await work()
        state = await model.currentState()
    }
}

struct PreferenceSection: View {
    @Environment(\.colorScheme) private var scheme

    let kind: NotificationKind
    let channels: [NotificationChannel]
    let state: NotificationSettingsState
    let onChange: (NotificationChannel, Bool) async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Text(kind.localizedName)
                .font(Tokens.Typography.subheadingRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

            ForEach(channels, id: \.rawValue) { channel in
                Toggle(
                    channel.localizedName,
                    isOn: Binding(
                        get: { state.isEnabled(kind, channel) },
                        set: { enabled in Task { await onChange(channel, enabled) } }
                    )
                )
                .disabled(state.saving != nil)
                .font(Tokens.Typography.bodyRelative)
                .frame(minHeight: Tokens.minimumTouchTarget)
            }

            if let quiet = state.quietHours(kind) {
                Text("\(L10n.string("notification.quietHours")): \(quiet.start)–\(quiet.end)")
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
        .padding(.vertical, Tokens.Spacing.xs)
    }
}

/**
 * One delivery attempt.
 *
 * The failure reason and the fallback marker are both shown. A notification
 * that silently failed is how a patient misses a check-up and believes nobody
 * told them — which, on this screen, they can now check.
 */
struct DeliveryRow: View {
    @Environment(\.colorScheme) private var scheme

    let delivery: DeliveredNotification

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            HStack {
                Text(delivery.title)
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                Spacer()

                Text(delivery.status.localizedName)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(tint.resolve(for: scheme))
            }

            Text("\(delivery.channel.localizedName) · \(delivery.createdAt.formatted(date: .abbreviated, time: .shortened))")
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            if delivery.isFallback {
                Text(L10n.string("notification.historyFallback"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }

            if let reason = delivery.failureReason {
                Text(reason)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.warning.resolve(for: scheme))
            }
        }
        .padding(.vertical, Tokens.Spacing.xs)
        .accessibilityElement(children: .combine)
    }

    private var tint: ThemedColor {
        switch delivery.status {
        case .delivered, .read: return Tokens.Palette.success
        case .failed: return Tokens.Palette.critical
        case .pending, .sent: return Tokens.Palette.info
        }
    }
}
