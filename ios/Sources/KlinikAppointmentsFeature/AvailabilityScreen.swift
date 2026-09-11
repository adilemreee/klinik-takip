import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

public enum AvailabilityPhase: Sendable, Equatable {
    case loading
    case loaded
    /// No hours published. **Not** a neutral empty state: while this is true
    /// the clinician cannot be booked at all.
    case empty
    case notFound
    case failed(String)
}

public struct AvailabilityState: Sendable, Equatable {
    public var phase: AvailabilityPhase = .loading
    public var windows: [AvailabilityWindow] = []
    public var working: String?
    public var saving = false
    public var error: String?

    public var byDay: [(day: Int, windows: [AvailabilityWindow])] {
        (0..<7).compactMap { day in
            // Sorted here rather than relying on the server's order: a day is
            // read down the page, and "09:00–12:00" under "14:00–17:00" is a
            // list somebody has to reorder in their head.
            let forDay = windows
                .filter { $0.dayOfWeek == day }
                .sorted { $0.startTime < $1.startTime }

            return forDay.isEmpty ? nil : (day, forDay)
        }
    }

    public init() {}
}

/**
 * The hours a clinician is bookable in (spec M10).
 *
 * The state worth designing for is the empty one. Until a window exists the
 * server refuses every booking — a doctor who has published no hours has not
 * offered any — so an empty list is not "nothing configured yet", it is "no
 * patient can book you". The screen says that in those words.
 */
public actor AvailabilityModel {
    private let api: AppointmentsAPI

    private(set) public var state = AvailabilityState()

    public init(api: AppointmentsAPI) {
        self.api = api
    }

    public func currentState() -> AvailabilityState { state }

    public func load() async {
        state.phase = .loading
        state.error = nil

        do {
            state.windows = try await api.availability()
            state.phase = state.windows.isEmpty ? .empty : .loaded
        } catch let error as APIError {
            if case .notFound = error {
                // No staff profile. A wiring problem, not an empty week.
                state.phase = .notFound
            } else {
                state.phase = .failed(L10n.message(for: error))
            }
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    @discardableResult
    public func publish(dayOfWeek: Int, startTime: String, endTime: String) async -> Bool {
        guard !state.saving else { return false }

        state.saving = true
        state.error = nil
        defer { state.saving = false }

        do {
            _ = try await api.publishAvailability(
                dayOfWeek: dayOfWeek,
                startTime: startTime,
                endTime: endTime
            )
        } catch let error as APIError {
            // The server's own words: it is the one that knows a window ends
            // before it starts, and our message would say less.
            state.error = L10n.message(for: error)
            return false
        } catch {
            state.error = L10n.string("error.server")
            return false
        }

        await load()
        return true
    }

    /// Switches a window off for a week away, without losing it.
    @discardableResult
    public func setActive(_ window: AvailabilityWindow, isActive: Bool) async -> Bool {
        await change(window.id) {
            _ = try await self.api.changeAvailability(
                window.id,
                dayOfWeek: window.dayOfWeek,
                startTime: window.startTime,
                endTime: window.endTime,
                isActive: isActive
            )
        }
    }

    @discardableResult
    public func withdraw(_ window: AvailabilityWindow) async -> Bool {
        await change(window.id) {
            try await self.api.withdrawAvailability(window.id)
        }
    }

    private func change(_ id: String, _ work: () async throws -> Void) async -> Bool {
        guard state.working == nil else { return false }

        state.working = id
        state.error = nil
        defer { state.working = nil }

        do {
            try await work()
        } catch let error as APIError {
            state.error = L10n.message(for: error)
            return false
        } catch {
            state.error = L10n.string("error.server")
            return false
        }

        await load()
        return true
    }
}

/// The week, as hours a patient can book into.
@MainActor
public struct AvailabilityScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: AvailabilityModel

    @State private var state = AvailabilityState()
    @State private var adding = false

    public init(model: AvailabilityModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                content
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("availability.title"))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(L10n.string("availability.add")) { adding = true }
            }
        }
        .sheet(isPresented: $adding) {
            AddWindowSheet { day, start, end in
                let published = await model.publish(
                    dayOfWeek: day,
                    startTime: start,
                    endTime: end
                )
                state = await model.currentState()

                // The reason, handed back to the sheet. It is what the reader
                // is looking at; a banner on the screen behind it is a message
                // nobody sees.
                return published ? nil : state.error ?? L10n.string("error.server")
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
    }

    @ViewBuilder
    private var content: some View {
        // Outside the switch: a window refused from the empty state set this
        // and then had nowhere to appear, which left the save button looking
        // like it did nothing at all.
        if let error = state.error {
            ErrorBanner(message: error)
        }

        switch state.phase {
        case .loading:
            SkeletonCard(lines: 4)
                .accessibilityElement()
                .accessibilityLabel(L10n.string("common.loading"))

        case .notFound:
            MessageState(icon: "questionmark.folder", text: L10n.string("availability.noProfile"))

        case .failed(let message):
            MessageState(
                icon: Tokens.State.labCritical.iconName,
                text: message,
                retryTitle: L10n.string("common.retry")
            ) {
                await reload()
            }

        case .empty:
            // Not a neutral empty state: while this is true nobody can book.
            Card(tone: .critical) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                    Text(L10n.string("availability.noneTitle"))
                        .font(Tokens.Typography.subheadingRelative)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(L10n.string("availability.noneDetail"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)

                    Button(L10n.string("availability.add")) { adding = true }
                        .buttonStyle(.borderedProminent)
                        .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                }
            }

        case .loaded:
            Text(L10n.string("availability.explain"))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                .fixedSize(horizontal: false, vertical: true)

            ForEach(state.byDay, id: \.day) { entry in
                VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                    SectionHeader(title: AvailabilityScreen.dayName(entry.day))

                    ForEach(entry.windows) { window in
                        WindowRow(
                            window: window,
                            isWorking: state.working == window.id,
                            setActive: { active in
                                await model.setActive(window, isActive: active)
                                state = await model.currentState()
                            },
                            withdraw: {
                                await model.withdraw(window)
                                state = await model.currentState()
                            }
                        )
                    }
                }
            }
        }
    }

    private func reload() async {
        await model.load()
        state = await model.currentState()
    }

    /**
     * The clinic's own week, in the reader's language.
     *
     * `Calendar.current`, not `Calendar(identifier: .gregorian)`. The latter
     * carries no locale and answers with the fixed English abbreviations —
     * "Mon", "Tue" — which is what a Turkish clinician was reading above their
     * own working hours.
     *
     * `nonisolated` because a static on a `View` otherwise inherits the view's
     * main-actor isolation, and the tests call it directly.
     */
    nonisolated static func dayName(_ dayOfWeek: Int, calendar: Calendar = .current) -> String {
        let symbols = calendar.weekdaySymbols

        // 0 = Sunday, matching the server, which is also Foundation's order.
        guard dayOfWeek >= 0, dayOfWeek < symbols.count else {
            return String(dayOfWeek)
        }

        return symbols[dayOfWeek].capitalized
    }
}

/// One published window.
struct WindowRow: View {
    @Environment(\.colorScheme) private var scheme
    @State private var confirmingWithdraw = false

    let window: AvailabilityWindow
    let isWorking: Bool
    let setActive: (Bool) async -> Void
    let withdraw: () async -> Void

    var body: some View {
        Card(tone: window.isActive ? .success : .neutral) {
            HStack(spacing: Tokens.Spacing.md) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                    Text("\(window.startTime) – \(window.endTime)")
                        .font(Tokens.Typography.subheadingRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                    // In words as well as colour (spec section 7).
                    Text(
                        L10n.string(
                            window.isActive ? "availability.open" : "availability.paused"
                        )
                    )
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(
                        (window.isActive ? Tone.success : Tone.neutral).foreground
                            .resolve(for: scheme)
                    )
                }

                Spacer(minLength: 0)

                // A switch rather than only a delete: a week away is not a
                // change to the working week, and making somebody re-enter
                // their hours afterwards is how they stop bothering.
                Toggle(
                    L10n.string("availability.openToggle"),
                    isOn: Binding(
                        get: { window.isActive },
                        set: { value in Task { await setActive(value) } }
                    )
                )
                .labelsHidden()
                .disabled(isWorking)

                Button(role: .destructive) {
                    confirmingWithdraw = true
                } label: {
                    Image(systemName: "trash")
                        .accessibilityLabel(L10n.string("availability.withdraw"))
                }
                .disabled(isWorking)
                .frame(minWidth: Tokens.minimumTouchTarget, minHeight: Tokens.minimumTouchTarget)
            }
        }
        .confirmationDialog(
            L10n.string("availability.withdrawTitle"),
            isPresented: $confirmingWithdraw,
            titleVisibility: .visible
        ) {
            Button(L10n.string("availability.withdraw"), role: .destructive) {
                Task { await withdraw() }
            }
            Button(L10n.string("common.cancel"), role: .cancel) {}
        } message: {
            Text(L10n.string("availability.withdrawDetail"))
        }
    }
}

/// Adding a window: a day and two times, and nothing else.
struct AddWindowSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    /// Returns the reason it was refused, or nil when it was accepted.
    let publish: (Int, String, String) async -> String?

    @State private var day = 1
    @State private var start = AddWindowSheet.time(hour: 9)
    @State private var end = AddWindowSheet.time(hour: 17)
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Picker(L10n.string("availability.day"), selection: $day) {
                    ForEach(0..<7, id: \.self) { value in
                        Text(AvailabilityScreen.dayName(value)).tag(value)
                    }
                }

                DatePicker(
                    L10n.string("availability.from"),
                    selection: $start,
                    displayedComponents: .hourAndMinute
                )

                DatePicker(
                    L10n.string("availability.to"),
                    selection: $end,
                    displayedComponents: .hourAndMinute
                )

                if !AddWindowSheet.isOrdered(start, end) {
                    Text(L10n.string("availability.endBeforeStart"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tone.critical.foreground.resolve(for: scheme))
                }

                if let error {
                    Text(error)
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tone.critical.foreground.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .navigationTitle(L10n.string("availability.add"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.string("common.cancel")) { dismiss() }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.string("common.save")) {
                        Task {
                            saving = true
                            error = nil
                            let refusal = await publish(
                                day,
                                AddWindowSheet.text(from: start),
                                AddWindowSheet.text(from: end)
                            )
                            saving = false
                            error = refusal

                            if refusal == nil { dismiss() }
                        }
                    }
                    .disabled(saving || !AddWindowSheet.isOrdered(start, end))
                }
            }
        }
    }

    /// `nonisolated` because statics on a `View` otherwise inherit the view's
    /// main-actor isolation, and the tests call these directly.
    nonisolated static func text(from date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)

        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    /// A window that ends before it starts matches nothing, so the server
    /// refuses it. Saying so here saves a round trip and a red banner.
    nonisolated static func isOrdered(_ start: Date, _ end: Date, calendar: Calendar = .current) -> Bool {
        text(from: start, calendar: calendar) < text(from: end, calendar: calendar)
    }

    nonisolated static func time(hour: Int, calendar: Calendar = .current) -> Date {
        calendar.date(bySettingHour: hour, minute: 0, second: 0, of: Date()) ?? Date()
    }
}
