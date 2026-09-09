import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * The clinic's month (spec M10).
 *
 * A grid rather than a list, because the question a clinician brings to a
 * calendar is "what does next Tuesday look like" and a list answers that by
 * making somebody scroll and count. Each day carries a dot per appointment up
 * to a limit, and a day with an unanswered request is marked in a way that
 * survives being read in greyscale.
 */
public struct CalendarScreen: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.calendar) private var calendar

    private let model: CalendarModel
    private let openPatient: (String, String) -> Void

    @State private var state = CalendarState()

    public init(model: CalendarModel, openPatient: @escaping (String, String) -> Void) {
        self.model = model
        self.openPatient = openPatient
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                ErrorBanner(message: state.error)

                header
                weekdayNames
                grid

                switch state.phase {
                case .loading:
                    SkeletonCard(lines: 3)

                case .failed(let message):
                    MessageState(
                        icon: Tokens.State.labCritical.iconName,
                        text: message,
                        retryTitle: L10n.string("common.retry")
                    ) {
                        await reload()
                    }

                case .loaded:
                    day
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("calendar.title"))
        .refreshable { await reload() }
        .task { await reload() }
    }

    // MARK: - Month

    private var header: some View {
        HStack {
            Button {
                Task {
                    await model.show(monthOffsetBy: -1)
                    state = model.currentState()
                }
            } label: {
                Label(L10n.string("calendar.previousMonth"), systemImage: "chevron.left")
                    .labelStyle(.iconOnly)
                    .frame(width: Tokens.minimumTouchTarget, height: Tokens.minimumTouchTarget)
            }
            .accessibilityLabel(L10n.string("calendar.previousMonth"))

            Spacer(minLength: 0)

            Text(state.month.formatted(.dateTime.month(.wide).year()))
                .font(Tokens.Typography.headingRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                .accessibilityAddTraits(.isHeader)

            Spacer(minLength: 0)

            Button {
                Task {
                    await model.show(monthOffsetBy: 1)
                    state = model.currentState()
                }
            } label: {
                Label(L10n.string("calendar.nextMonth"), systemImage: "chevron.right")
                    .labelStyle(.iconOnly)
                    .frame(width: Tokens.minimumTouchTarget, height: Tokens.minimumTouchTarget)
            }
            .accessibilityLabel(L10n.string("calendar.nextMonth"))
        }
    }

    /// Short weekday names in the reader's own order, taken from the calendar
    /// rather than written out: a week starting on the wrong day is a week
    /// somebody misreads.
    private var weekdayNames: some View {
        let symbols = calendar.shortStandaloneWeekdaySymbols
        let ordered = Array(symbols[(calendar.firstWeekday - 1)...] + symbols[..<(calendar.firstWeekday - 1)])

        return HStack(spacing: Tokens.Spacing.xs) {
            ForEach(ordered, id: \.self) { name in
                Text(name)
                    .font(Tokens.Typography.footnoteRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }

    private var grid: some View {
        let days = CalendarModel.gridDays(for: state.month, calendar: calendar)
        let counts = model.counts()

        return LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: Tokens.Spacing.xs), count: 7),
            spacing: Tokens.Spacing.xs
        ) {
            ForEach(days, id: \.self) { date in
                DayCell(
                    date: date,
                    count: counts[calendar.startOfDay(for: date)] ?? 0,
                    isInMonth: calendar.isDate(date, equalTo: state.month, toGranularity: .month),
                    isToday: calendar.isDateInToday(date),
                    isSelected: state.selected.map { calendar.isDate(date, inSameDayAs: $0) } ?? false,
                    hasRequest: model.hasRequests(on: date)
                ) {
                    model.select(date)
                    state = model.currentState()
                }
            }
        }
    }

    // MARK: - The chosen day

    @ViewBuilder
    private var day: some View {
        let chosen = state.selected ?? Date()
        let entries = model.entries(on: chosen)

        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(
                title: chosen.formatted(date: .complete, time: .omitted),
                subtitle: entries.isEmpty
                    ? nil
                    : String(format: L10n.string("calendar.appointmentCount"), entries.count)
            )

            if entries.isEmpty {
                Card {
                    Text(L10n.string("calendar.nothingThatDay"))
                        .font(Tokens.Typography.bodyRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }
            } else {
                ForEach(entries) { entry in
                    card(entry)
                }
            }
        }
    }

    private func card(_ entry: CalendarEntry) -> some View {
        Card(tone: entry.appointment.status == .requested ? .warning : .neutral) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                Button {
                    openPatient(entry.patient.id, entry.patient.fullName)
                } label: {
                    HStack(spacing: Tokens.Spacing.md) {
                        VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                            Text(entry.appointment.scheduledAt.formatted(date: .omitted, time: .shortened))
                                .font(Tokens.Typography.headingRelative)
                                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                            Text(
                                String(
                                    format: L10n.string("calendar.minutes"),
                                    entry.appointment.durationMinutes
                                )
                            )
                            .font(Tokens.Typography.captionRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        }
                        .frame(width: 86, alignment: .leading)

                        VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                            Text(entry.patient.fullName)
                                .font(Tokens.Typography.subheadingRelative)
                                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                            Text(entry.appointment.type.localizedName)
                                .font(Tokens.Typography.captionRelative)
                                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        }

                        Spacer(minLength: Tokens.Spacing.sm)

                        Image(systemName: "chevron.right")
                            .font(Tokens.Typography.captionRelative)
                            .foregroundStyle(Tokens.Palette.textDisabled.resolve(for: scheme))
                            .accessibilityHidden(true)
                    }
                    .frame(minHeight: Tokens.minimumTouchTarget)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isButton)

                HStack(spacing: Tokens.Spacing.sm) {
                    Badge(
                        entry.appointment.status.localizedName,
                        tone: entry.appointment.status == .requested ? .warning : .success,
                        symbol: entry.appointment.status == .requested
                            ? "questionmark.circle"
                            : "checkmark.circle"
                    )

                    if let location = entry.appointment.location {
                        Badge(location, symbol: "mappin")
                    }

                    Spacer(minLength: 0)
                }

                if entry.appointment.status == .requested {
                    PrimaryButton(
                        title: L10n.string("appointment.confirm"),
                        isBusy: state.busyId == entry.id,
                        isEnabled: state.busyId == nil
                    ) {
                        await model.confirm(entry.appointment.id)
                        state = model.currentState()
                    }
                }
            }
        }
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}

/// One square of the month.
struct DayCell: View {
    @Environment(\.colorScheme) private var scheme

    let date: Date
    let count: Int
    let isInMonth: Bool
    let isToday: Bool
    let isSelected: Bool
    let hasRequest: Bool
    let select: () -> Void

    var body: some View {
        Button(action: select) {
            VStack(spacing: Tokens.Spacing.xxs) {
                Text(date.formatted(.dateTime.day()))
                    .font(Tokens.Typography.calloutRelative)
                    .foregroundStyle(numberColour)

                // Dots, capped: a day with nine appointments and a day with
                // twelve look the same anyway, and counting them is not the
                // job of a month view.
                HStack(spacing: 2) {
                    ForEach(0..<min(count, 3), id: \.self) { _ in
                        Circle()
                            .fill(
                                (hasRequest ? Tokens.Palette.warning : Tokens.Palette.accent)
                                    .resolve(for: scheme)
                            )
                            .frame(width: 5, height: 5)
                    }
                }
                .frame(height: 6)
            }
            .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.sm))
            .overlay(
                RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                    .stroke(
                        isToday
                            ? Tokens.Palette.accent.resolve(for: scheme)
                            : Color.clear,
                        lineWidth: 1.5
                    )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private var numberColour: Color {
        if !isInMonth { return Tokens.Palette.textDisabled.resolve(for: scheme) }

        return isSelected
            ? Tokens.Palette.accentText.resolve(for: scheme)
            : Tokens.Palette.textPrimary.resolve(for: scheme)
    }

    private var background: Color {
        isSelected
            ? Tokens.Palette.accent.resolve(for: scheme)
            : Tokens.Palette.surface.resolve(for: scheme).opacity(isInMonth ? 1 : 0.4)
    }

    /// Spoken as a sentence: a screen reader moving across a grid of bare
    /// numbers tells somebody nothing about which day is busy.
    private var label: String {
        var parts = [date.formatted(date: .complete, time: .omitted)]

        if count > 0 {
            parts.append(String(format: L10n.string("calendar.appointmentCount"), count))
        }

        if hasRequest {
            parts.append(L10n.string("calendar.hasRequest"))
        }

        return parts.joined(separator: ", ")
    }
}
