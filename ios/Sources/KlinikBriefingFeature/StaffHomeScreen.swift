import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * The doctor's agenda — the first screen after signing in (spec M2, M5).
 *
 * Ordered the way a clinician triages rather than the way the data arrives:
 * an unanswered emergency is at the top and cannot be scrolled past, today's
 * work is next because it is what the day will be spent on, and yesterday's
 * counts are at the bottom because they are context, not a task.
 */
public struct StaffHomeScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: StaffHomeModel
    private let onSelect: (StaffHomeTarget) -> Void

    @State private var state = StaffHomeState()

    public init(model: StaffHomeModel, onSelect: @escaping (StaffHomeTarget) -> Void) {
        self.model = model
        self.onSelect = onSelect
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.xl) {
                greeting

                switch state.phase {
                case .loading:
                    skeleton

                case .failed(let message):
                    MessageState(
                        icon: Tokens.State.labCritical.iconName,
                        text: message,
                        retryTitle: L10n.string("common.retry")
                    ) {
                        await reload()
                    }

                case .loaded:
                    loaded
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .refreshable { await reload() }
        .task { await reload() }
    }

    // MARK: - Header

    private var greeting: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
            Text(StaffHomeScreen.greetingText(for: Date()))
                .font(Tokens.Typography.titleRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                .accessibilityAddTraits(.isHeader)

            Text(Date().formatted(date: .complete, time: .omitted))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
        }
    }

    /// Morning until noon, afternoon until six, evening after. A greeting that
    /// says "günaydın" at nine at night reads as a machine talking.
    static func greetingText(for date: Date, calendar: Calendar = .current) -> String {
        switch calendar.component(.hour, from: date) {
        case 0..<12: return L10n.string("briefing.greeting.morning")
        case 12..<18: return L10n.string("briefing.greeting.afternoon")
        default: return L10n.string("briefing.greeting.evening")
        }
    }

    // MARK: - Loaded

    @ViewBuilder
    private var loaded: some View {
        if state.hasEmergencies {
            emergencyBanner
        }

        queues

        today

        let risks = model.risks()
        if !risks.isEmpty {
            waiting(risks)
        }

        if let narrative = state.briefing?.narrative, !narrative.isEmpty {
            summary(narrative)
        }

        yesterday

        if state.briefing?.quiet == true, !state.hasEmergencies, risks.isEmpty {
            Card(tone: .success) {
                HStack(spacing: Tokens.Spacing.md) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(Tokens.Typography.headingRelative)
                        .foregroundStyle(Tokens.Palette.success.resolve(for: scheme))
                        .accessibilityHidden(true)

                    Text(L10n.string("briefing.quiet"))
                        .font(Tokens.Typography.bodyRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    /// The one thing on this screen that is allowed to shout.
    private var emergencyBanner: some View {
        Card(tone: .critical) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                HStack(spacing: Tokens.Spacing.sm) {
                    Image(systemName: Tokens.State.triageEmergency.iconName)
                        .font(Tokens.Typography.headingRelative)
                        .foregroundStyle(Tokens.Palette.critical.resolve(for: scheme))
                        .accessibilityHidden(true)

                    Text(
                        String(
                            format: L10n.string("briefing.emergencyOpen"),
                            state.emergencies.count
                        )
                    )
                    .font(Tokens.Typography.headingRelative)
                    .foregroundStyle(Tokens.Palette.critical.resolve(for: scheme))
                }

                ForEach(state.emergencies.prefix(3)) { call in
                    HStack(spacing: Tokens.Spacing.sm) {
                        Text(call.summary.fullName)
                            .font(Tokens.Typography.subheadingRelative)
                            .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                        Spacer(minLength: Tokens.Spacing.sm)

                        if call.unanswered {
                            Badge(
                                L10n.string("emergency.unanswered"),
                                tone: .critical,
                                symbol: "bell.badge.fill"
                            )
                        }

                        Text(StaffHomeScreen.waiting(minutes: call.waitingMinutes))
                            .font(Tokens.Typography.captionRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    }
                    .accessibilityElement(children: .combine)
                }

                Button(L10n.string("briefing.openQueue")) { onSelect(.emergencyQueue) }
                    .font(Tokens.Typography.subheadingRelative)
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.accentText.resolve(for: scheme))
                    .background(Tokens.Palette.critical.resolve(for: scheme))
                    .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
            }
        }
    }

    /// Work queues this account is allowed to see. Absent, not zero, when it
    /// is not — a nurse should not be shown a review queue she cannot open.
    @ViewBuilder
    private var queues: some View {
        let pending = state.pendingReportCount ?? 0
        let flagged = state.flaggedPhotoCount ?? 0

        if pending > 0 || flagged > 0 {
            Card {
                VStack(spacing: 0) {
                    if pending > 0 {
                        NavigationRow(
                            symbol: "doc.text.magnifyingglass",
                            title: L10n.string("briefing.pendingReports"),
                            detail: L10n.string("briefing.pendingReportsHint"),
                            badge: "\(pending)",
                            badgeTone: .warning
                        ) {
                            onSelect(.pendingReports)
                        }
                    }

                    if flagged > 0 {
                        if pending > 0 { Divider() }

                        NavigationRow(
                            symbol: "photo.badge.exclamationmark",
                            title: L10n.string("briefing.flaggedPhotos"),
                            detail: L10n.string("briefing.flaggedPhotosHint"),
                            badge: "\(flagged)",
                            badgeTone: .warning
                        ) {
                            onSelect(.flaggedPhotos)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var today: some View {
        if let facts = state.briefing?.facts {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(title: L10n.string("briefing.today"))

                HStack(spacing: Tokens.Spacing.md) {
                    StatTile(
                        value: "\(facts.today.appointments)",
                        label: L10n.string("briefing.appointments"),
                        tone: facts.today.appointments > 0 ? .info : .neutral,
                        symbol: "calendar"
                    )

                    StatTile(
                        value: "\(facts.today.followUps)",
                        label: L10n.string("briefing.followUps"),
                        tone: facts.today.followUps > 0 ? .info : .neutral,
                        symbol: "checkmark.circle"
                    )
                }
            }
        }
    }

    private func waiting(_ risks: [RiskItem]) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(
                title: L10n.string("briefing.atRisk"),
                subtitle: String(format: L10n.string("briefing.riskCount"), risks.count)
            )

            ForEach(risks) { risk in
                Button {
                    onSelect(.patient(id: risk.patientId, name: risk.patientName))
                } label: {
                    riskCard(risk)
                }
                .buttonStyle(.plain)
                .frame(minHeight: Tokens.minimumTouchTarget)
            }
        }
    }

    private func riskCard(_ risk: RiskItem) -> some View {
        Card(tone: risk.kind.tone.designTone) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                HStack(spacing: Tokens.Spacing.md) {
                    InitialsAvatar(name: risk.patientName, diameter: 40)

                    VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                        Text(risk.patientName)
                            .font(Tokens.Typography.subheadingRelative)
                            .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                        Text(risk.localizedWaiting)
                            .font(Tokens.Typography.captionRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    }

                    Spacer(minLength: Tokens.Spacing.sm)

                    Image(systemName: "chevron.right")
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textDisabled.resolve(for: scheme))
                        .accessibilityHidden(true)
                }

                Badge(
                    risk.kind.localizedName,
                    tone: risk.kind.tone.designTone,
                    symbol: risk.kind.symbol
                )

                Text(risk.detail)
                    .font(Tokens.Typography.calloutRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    private func summary(_ narrative: String) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(title: L10n.string("briefing.aiSummary"))

            Card(tone: .info) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                    Text(narrative)
                        .font(Tokens.Typography.bodyRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)

                    // Required under every AI output (spec M5). Not a footnote
                    // the reader has to hunt for: same card, always visible.
                    Text(L10n.string("briefing.aiDisclaimer"))
                        .font(Tokens.Typography.footnoteRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    @ViewBuilder
    private var yesterday: some View {
        if let facts = state.briefing?.facts {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(title: L10n.string("briefing.yesterday"))

                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: Tokens.Spacing.md),
                        GridItem(.flexible(), spacing: Tokens.Spacing.md),
                        GridItem(.flexible(), spacing: Tokens.Spacing.md),
                    ],
                    spacing: Tokens.Spacing.md
                ) {
                    StatTile(
                        value: "\(facts.yesterday.newMessages)",
                        label: L10n.string("briefing.newMessages"),
                        symbol: "bubble.left.and.bubble.right"
                    )
                    StatTile(
                        value: "\(facts.yesterday.urgentMessages)",
                        label: L10n.string("briefing.urgentMessages"),
                        tone: facts.yesterday.urgentMessages > 0 ? .warning : .neutral,
                        symbol: "exclamationmark.bubble"
                    )
                    StatTile(
                        value: "\(facts.yesterday.emergencies)",
                        label: L10n.string("briefing.emergencies"),
                        tone: facts.yesterday.emergencies > 0 ? .critical : .neutral,
                        symbol: "phone.badge.waveform"
                    )
                    StatTile(
                        value: "\(facts.yesterday.complications)",
                        label: L10n.string("briefing.complications"),
                        tone: facts.yesterday.complications > 0 ? .warning : .neutral,
                        symbol: "bandage"
                    )
                    StatTile(
                        value: "\(facts.yesterday.criticalLabs)",
                        label: L10n.string("briefing.criticalLabs"),
                        tone: facts.yesterday.criticalLabs > 0 ? .critical : .neutral,
                        symbol: "testtube.2"
                    )
                }
            }
        }
    }

    // MARK: - Loading

    private var skeleton: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
            SkeletonCard(lines: 2)
            SkeletonCard(lines: 4)
            SkeletonCard(lines: 3)
        }
        .accessibilityElement()
        .accessibilityLabel(L10n.string("common.loading"))
    }

    // MARK: - Helpers

    static func waiting(minutes: Int) -> String {
        minutes < 60
            ? String(format: L10n.string("briefing.waitingMinutes"), minutes)
            : String(format: L10n.string("briefing.waitingHours"), minutes / 60)
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}

extension RiskTone {
    var designTone: Tone {
        switch self {
        case .info: return .info
        case .warning: return .warning
        case .critical: return .critical
        }
    }
}
