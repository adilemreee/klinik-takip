import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * The doctor's agenda — the first screen after signing in (spec M2, M5).
 *
 * Ordered the way a clinician triages rather than the way the data arrives:
 * an unanswered emergency is at the top and cannot be scrolled past, the
 * people already waiting come next, then the day as the clock will run it,
 * and yesterday's counts are near the bottom because they are context rather
 * than a task.
 *
 * It ends with the clinic's other screens by name. A morning with nothing
 * wrong in it is the common case, and a screen that has nothing to say on
 * those mornings is a screen a clinician stops opening.
 */
public struct StaffHomeScreen: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var typeSize

    private let model: StaffHomeModel
    /// Who is reading. Nil until `/me/identity` answers, and on the rare
    /// account that has no name — the greeting stands on its own then.
    private let clinicianName: String?
    private let onSelect: (StaffHomeTarget) -> Void

    @State private var state = StaffHomeState()

    public init(
        model: StaffHomeModel,
        clinicianName: String? = nil,
        onSelect: @escaping (StaffHomeTarget) -> Void
    ) {
        self.model = model
        self.clinicianName = clinicianName
        self.onSelect = onSelect
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.xl) {
                hero

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

    /**
     * The greeting, the date, and the morning in one sentence.
     *
     * The sentence is the point. Everything under it is detail, and a
     * clinician who reads nothing else should still know from the top of the
     * screen whether anybody is waiting on them.
     */
    private var hero: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            HStack(alignment: .top, spacing: Tokens.Spacing.md) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                    Text(greetingLine)
                        .font(Tokens.Typography.titleRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)

                    Text(Date().formatted(date: .complete, time: .omitted))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }

                Spacer(minLength: Tokens.Spacing.sm)

                // The hour of the day, drawn. Decoration, and hidden: the
                // greeting beside it already says morning or evening.
                Image(systemName: StaffHomeScreen.daySymbol(for: Date()))
                    .font(.system(size: 30))
                    .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                    .accessibilityHidden(true)
            }

            if let status {
                HStack(spacing: Tokens.Spacing.sm) {
                    Image(systemName: status.symbol)
                        .font(Tokens.Typography.calloutRelative)
                        .foregroundStyle(status.tone.foreground.resolve(for: scheme))
                        .accessibilityHidden(true)

                    Text(status.text)
                        .font(Tokens.Typography.calloutRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, Tokens.Spacing.md)
                .padding(.vertical, Tokens.Spacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(status.tone.surface.resolve(for: scheme))
                .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
                .accessibilityElement(children: .combine)
            }
        }
        .padding(Tokens.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [
                    Tokens.Palette.infoSurface.resolve(for: scheme),
                    Tokens.Palette.surfaceRaised.resolve(for: scheme),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: Tokens.Radius.lg)
                .stroke(Tokens.Palette.border.resolve(for: scheme), lineWidth: 1)
        )
    }

    private var greetingLine: String {
        let greeting = StaffHomeScreen.greetingText(for: Date())

        guard let clinicianName, !clinicianName.isEmpty else { return greeting }

        return "\(greeting), \(clinicianName)"
    }

    /// The morning in one line: the loudest true thing, or that there is none.
    private var status: (text: String, tone: Tone, symbol: String)? {
        guard case .loaded = state.phase else { return nil }

        if state.hasEmergencies {
            return (
                String(format: L10n.string("briefing.emergencyOpen"), state.emergencies.count),
                .critical,
                Tokens.State.triageEmergency.iconName
            )
        }

        let waiting = model.risks().count

        if waiting > 0 {
            return (
                String(format: L10n.string("briefing.riskCount"), waiting),
                .warning,
                "clock.badge.exclamationmark"
            )
        }

        return (L10n.string("briefing.quiet"), .success, "checkmark.circle.fill")
    }

    /// Morning until noon, afternoon until six, evening after. A greeting that
    /// says "günaydın" at nine at night reads as a machine talking.
    nonisolated static func greetingText(for date: Date, calendar: Calendar = .current) -> String {
        switch calendar.component(.hour, from: date) {
        case 0..<12: return L10n.string("briefing.greeting.morning")
        case 12..<18: return L10n.string("briefing.greeting.afternoon")
        default: return L10n.string("briefing.greeting.evening")
        }
    }

    nonisolated static func daySymbol(for date: Date, calendar: Calendar = .current) -> String {
        switch calendar.component(.hour, from: date) {
        case 0..<12: return "sunrise.fill"
        case 12..<18: return "sun.max.fill"
        default: return "moon.stars.fill"
        }
    }

    // MARK: - Loaded

    @ViewBuilder
    private var loaded: some View {
        let risks = model.risks()

        if state.hasEmergencies {
            emergencyBanner
        }

        if !risks.isEmpty {
            waiting(risks)
        }

        today

        queues

        if let narrative = state.briefing?.narrative, !narrative.isEmpty {
            summary(narrative)
        }

        yesterday

        shortcuts
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

    /**
     * Work queues this account is allowed to see.
     *
     * A row appears when the count is readable at all, not when it is greater
     * than zero: a nurse who may not review reports should not be shown a
     * review queue, but a doctor whose queue is empty should still be able to
     * see that it is — hiding it made the feature look as though it had been
     * taken away.
     */
    @ViewBuilder
    private var queues: some View {
        if state.pendingReportCount != nil || state.flaggedPhotoCount != nil {
            Card {
                VStack(spacing: 0) {
                    if let pending = state.pendingReportCount {
                        NavigationRow(
                            symbol: "doc.text.magnifyingglass",
                            title: L10n.string("briefing.pendingReports"),
                            detail: L10n.string("briefing.pendingReportsHint"),
                            badge: pending > 0 ? "\(pending)" : nil,
                            badgeTone: .warning
                        ) {
                            onSelect(.pendingReports)
                        }
                    }

                    if let flagged = state.flaggedPhotoCount {
                        if state.pendingReportCount != nil { Divider() }

                        NavigationRow(
                            symbol: "photo.badge.exclamationmark",
                            title: L10n.string("briefing.flaggedPhotos"),
                            detail: L10n.string("briefing.flaggedPhotosHint"),
                            badge: flagged > 0 ? "\(flagged)" : nil,
                            badgeTone: .warning
                        ) {
                            onSelect(.flaggedPhotos)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Today

    @ViewBuilder
    private var today: some View {
        if let facts = state.briefing?.facts {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(
                    title: L10n.string("briefing.today"),
                    subtitle: String(
                        format: L10n.string("briefing.todayCount"),
                        facts.today.appointments,
                        facts.today.followUps
                    ),
                    actionTitle: L10n.string("menu.calendar")
                ) {
                    onSelect(.tool(.calendar))
                }

                // Both counts, always — a zero is an answer, and a tile that
                // disappears when nothing is booked reads as a tile somebody
                // removed. Colour is what a count earns by not being zero.
                //
                // Side by side until half a screen stops being enough for the
                // word "Randevu", which at the accessibility sizes SwiftUI
                // breaks in two rather than wrapping.
                AdaptiveStack(stacked: typeSize.isAccessibilitySize) {
                    StatTile(
                        value: "\(facts.today.appointments)",
                        label: L10n.string("briefing.appointments"),
                        tone: facts.today.appointments > 0 ? .info : .neutral,
                        symbol: "calendar"
                    )

                    StatTile(
                        value: "\(facts.today.followUps)",
                        label: L10n.string("briefing.followUps"),
                        tone: facts.today.followUps > 0 ? .success : .neutral,
                        symbol: "checkmark.circle"
                    )
                }

                schedule
            }
        }
    }

    /**
     * The day as the clock will run it.
     *
     * The briefing counts appointments; it does not say whose or when, and a
     * doctor reading "6" has been told the size of their day and nothing they
     * can act on. This is the calendar for today, by the hour, and every row
     * opens the file of the person it names.
     *
     * Absent rather than empty when the calendar could not be read: "no
     * appointments today" is a claim, and an account that may not read the
     * calendar has no business making it.
     */
    @ViewBuilder
    private var schedule: some View {
        if let entries = state.schedule {
            if entries.isEmpty {
                // Only when the day has something else in it. On a morning
                // where every number is zero the two tiles above have already
                // said so, and a third sentence saying it again is padding.
                if hasAnythingToday {
                    Card {
                        Text(L10n.string(emptyScheduleKey))
                            .font(Tokens.Typography.bodyRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            } else {
                let next = StaffHomeScreen.nextUp(in: entries, at: Date())

                Card {
                    VStack(spacing: 0) {
                        ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                            if index > 0 {
                                Divider().padding(.vertical, Tokens.Spacing.xs)
                            }

                            scheduleRow(entry, isNext: entry.id == next)
                        }
                    }
                }
            }
        }
    }

    private var hasAnythingToday: Bool {
        guard let today = state.briefing?.facts.today else { return false }

        return today.appointments > 0 || today.followUps > 0
    }

    /// Nothing booked is a different sentence from nothing at all.
    private var emptyScheduleKey: String {
        (state.briefing?.facts.today.followUps ?? 0) > 0
            ? "briefing.noAppointmentsToday"
            : "briefing.nothingToday"
    }

    private func scheduleRow(_ entry: CalendarEntry, isNext: Bool) -> some View {
        let appointment = entry.appointment
        let done = !appointment.status.isUpcoming
        let tone: Tone = done ? .neutral : (isNext ? .info : .success)

        return Button {
            onSelect(.patient(id: entry.patient.id, name: entry.patient.fullName))
        } label: {
            HStack(spacing: Tokens.Spacing.md) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                    Text(appointment.scheduledAt.formatted(date: .omitted, time: .shortened))
                        .font(Tokens.Typography.subheadingRelative)
                        .monospacedDigit()
                        .foregroundStyle(
                            (done ? Tokens.Palette.textSecondary : Tokens.Palette.textPrimary)
                                .resolve(for: scheme)
                        )

                    Text("\(appointment.durationMinutes)′")
                        .font(Tokens.Typography.footnoteRelative)
                        .monospacedDigit()
                        .foregroundStyle(Tokens.Palette.textDisabled.resolve(for: scheme))
                }
                .frame(width: 58, alignment: .leading)

                // The hour's colour, as a rail rather than a dot: it lines the
                // row up with the two beside it and never lands on the text.
                RoundedRectangle(cornerRadius: Tokens.Radius.pill)
                    .fill(tone.foreground.resolve(for: scheme))
                    .frame(width: 3)

                VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                    Text(entry.patient.fullName)
                        .font(Tokens.Typography.subheadingRelative)
                        .foregroundStyle(
                            (done ? Tokens.Palette.textSecondary : Tokens.Palette.textPrimary)
                                .resolve(for: scheme)
                        )
                        .multilineTextAlignment(.leading)

                    FlowRow(spacing: Tokens.Spacing.xs) {
                        Badge(appointment.type.localizedName, tone: .neutral)

                        if isNext {
                            Badge(
                                L10n.string("briefing.next"),
                                tone: .info,
                                symbol: "arrow.forward.circle.fill"
                            )
                        }

                        if done {
                            Badge(appointment.status.localizedName, tone: .neutral)
                        }
                    }
                }

                Spacer(minLength: Tokens.Spacing.sm)

                // Decoration: the row already carries the button trait.
                Image(systemName: "chevron.right")
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textDisabled.resolve(for: scheme))
                    .accessibilityHidden(true)
            }
            .padding(.vertical, Tokens.Spacing.sm)
            .frame(minHeight: Tokens.minimumTouchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    // MARK: - Waiting

    private func waiting(_ risks: [RiskItem]) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            // No count in the subtitle: the line at the top of the screen has
            // just said "2 kişi bekliyor", and the cards below are the two.
            SectionHeader(title: L10n.string("briefing.atRisk"))

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

                    // Decoration: the card is the button.
                    Image(systemName: "chevron.right")
                        .accessibilityHidden(true)
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textDisabled.resolve(for: scheme))
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

    // MARK: - Yesterday

    /**
     * What the clinic did while nobody was looking.
     *
     * All five counts, every morning. They were briefly filtered down to the
     * ones above zero, which read as though the app had lost four of them —
     * and a doctor who cannot see that yesterday had no emergencies has not
     * been told that yesterday had no emergencies. A zero is an answer; it
     * simply does not get to wear the colour that means something happened.
     */
    @ViewBuilder
    private var yesterday: some View {
        if let facts = state.briefing?.facts {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(title: L10n.string("briefing.yesterday"))

                Card {
                    VStack(spacing: 0) {
                        let metrics = StaffHomeScreen.yesterdayMetrics(facts.yesterday)

                        ForEach(Array(metrics.enumerated()), id: \.element.id) { index, metric in
                            if index > 0 {
                                Divider().padding(.vertical, Tokens.Spacing.xs)
                            }

                            metricRow(metric)
                        }
                    }
                }
            }
        }
    }

    private func metricRow(_ metric: YesterdayMetric) -> some View {
        HStack(spacing: Tokens.Spacing.md) {
            // Decoration: the row is announced as "kritik tahlil, 3".
            Image(systemName: metric.symbol)
                .accessibilityHidden(true)
                .font(Tokens.Typography.calloutRelative)
                .foregroundStyle(metric.shownTone.foreground.resolve(for: scheme))
                .frame(width: 34, height: 34)
                .background(metric.shownTone.surface.resolve(for: scheme))
                .clipShape(Circle())

            Text(L10n.string(metric.labelKey))
                .font(Tokens.Typography.bodyRelative)
                .foregroundStyle(
                    (metric.isQuiet ? Tokens.Palette.textSecondary : Tokens.Palette.textPrimary)
                        .resolve(for: scheme)
                )
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)

            Spacer(minLength: Tokens.Spacing.sm)

            Text("\(metric.value)")
                .font(Tokens.Typography.headingRelative)
                .monospacedDigit()
                .foregroundStyle(
                    (metric.isQuiet ? Tokens.Palette.textDisabled : metric.shownTone.foreground)
                        .resolve(for: scheme)
                )
        }
        .padding(.vertical, Tokens.Spacing.xs)
        .frame(minHeight: Tokens.minimumTouchTarget)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(L10n.string(metric.labelKey)), \(metric.value)")
    }

    // MARK: - The rest of the clinic

    /**
     * Everything else, by name.
     *
     * These are the toolbar menu's entries, drawn. The menu stays — a habit is
     * worth keeping — but a feature reachable only from a menu of fifteen is a
     * feature most people never learn the app has.
     */
    private var shortcuts: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(title: L10n.string("briefing.shortcuts"))

            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 104), spacing: Tokens.Spacing.md)],
                spacing: Tokens.Spacing.md
            ) {
                ForEach(StaffTool.allCases) { tool in
                    shortcut(tool)
                }
            }
        }
    }

    private func shortcut(_ tool: StaffTool) -> some View {
        Button {
            onSelect(.tool(tool))
        } label: {
            VStack(spacing: Tokens.Spacing.sm) {
                // Decoration: the tile announces its own title below.
                Image(systemName: tool.symbol)
                    .accessibilityHidden(true)
                    .font(.system(size: 20))
                    .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                    .frame(width: 44, height: 44)
                    .background(Tokens.Palette.infoSurface.resolve(for: scheme))
                    .clipShape(Circle())

                Text(L10n.string(tool.titleKey))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: 104)
            .padding(.vertical, Tokens.Spacing.sm)
            .padding(.horizontal, Tokens.Spacing.xs)
            .background(Tokens.Palette.surface.resolve(for: scheme))
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.lg))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L10n.string(tool.titleKey))
        .accessibilityAddTraits(.isButton)
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

    /// One of yesterday's counts, and whether it counted anything.
    struct YesterdayMetric: Identifiable, Equatable {
        let labelKey: String
        let value: Int
        let tone: Tone
        let symbol: String

        var id: String { labelKey }

        var isQuiet: Bool { value == 0 }

        /// Colour is earned. A zero is drawn in the neutral tone so the eye
        /// lands on the counts that mean something, without any of them
        /// leaving the screen.
        var shownTone: Tone { isQuiet ? .neutral : tone }
    }

    /// `nonisolated` because a static on a `View` otherwise inherits the
    /// view's main-actor isolation, and the tests call it directly.
    nonisolated static func yesterdayMetrics(_ facts: BriefingYesterday) -> [YesterdayMetric] {
        [
            YesterdayMetric(
                labelKey: "briefing.newMessages",
                value: facts.newMessages,
                tone: .info,
                symbol: "bubble.left.and.bubble.right.fill"
            ),
            YesterdayMetric(
                labelKey: "briefing.urgentMessages",
                value: facts.urgentMessages,
                tone: .warning,
                symbol: "exclamationmark.bubble.fill"
            ),
            YesterdayMetric(
                labelKey: "briefing.emergencies",
                value: facts.emergencies,
                tone: .critical,
                symbol: "phone.badge.waveform.fill"
            ),
            YesterdayMetric(
                labelKey: "briefing.complications",
                value: facts.complications,
                tone: .warning,
                symbol: "bandage.fill"
            ),
            YesterdayMetric(
                labelKey: "briefing.criticalLabs",
                value: facts.criticalLabs,
                tone: .critical,
                symbol: "testtube.2"
            ),
        ]
    }

    /**
     * The next appointment still to come, by id.
     *
     * The first one that has not ended and that somebody is still expected at:
     * a cancelled slot is not next, and neither is the one that finished ten
     * minutes ago. Nil once the day is done, which is when nothing should be
     * marked.
     */
    nonisolated static func nextUp(in schedule: [CalendarEntry], at now: Date) -> String? {
        schedule
            .filter { $0.appointment.status.isUpcoming && $0.appointment.endsAt > now }
            .min { $0.appointment.scheduledAt < $1.appointment.scheduledAt }?
            .id
    }

    nonisolated static func waiting(minutes: Int) -> String {
        minutes < 60
            ? String(format: L10n.string("common.waitingMinutes"), minutes)
            : String(format: L10n.string("common.waitingHours"), minutes / 60)
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
