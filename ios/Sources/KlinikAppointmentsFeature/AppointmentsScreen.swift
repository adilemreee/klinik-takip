import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// Appointments: what is booked, and asking for another (spec M10).
public struct AppointmentsScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: AppointmentsModel
    /// Staff confirm and reschedule; a patient asks and cancels.
    private let canConfirm: Bool

    @State private var state = AppointmentsState()
    @State private var calendarFile: URL?
    @State private var exporting = false
    @State private var booking = false

    public init(model: AppointmentsModel, canConfirm: Bool = false) {
        self.model = model
        self.canConfirm = canConfirm
    }

    public var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("menu.appointments"))
        .task { await refresh { await model.refresh() } }
        // Staff read the same appointments from the calendar screen; the file
        // is the patient's own, so the button is theirs.
        .toolbar {
            if canConfirm {
                ToolbarItem(placement: .primaryAction) {
                    Button { booking = true } label: {
                        Label(L10n.string("appointment.book"), systemImage: "plus")
                    }
                    .frame(minHeight: Tokens.minimumTouchTarget)
                }
            }

            if !canConfirm {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task {
                            exporting = true
                            calendarFile = await model.calendarFile()
                            state = await model.currentState()
                            exporting = false
                        }
                    } label: {
                        if exporting {
                            ProgressView().accessibilityLabel(L10n.string("common.loading"))
                        } else {
                            Label(L10n.string("appointment.addToCalendar"), systemImage: "calendar.badge.plus")
                        }
                    }
                    .frame(minHeight: Tokens.minimumTouchTarget)
                    .accessibilityLabel(L10n.string("appointment.addToCalendar"))
                }
            }
        }
        .sheet(item: $calendarFile) { url in
            ShareSheet(url: url)
        }
        .sheet(isPresented: $booking) {
            BookAppointmentSheet { type, at, minutes, location, note in
                let ok = await model.book(
                    type: type,
                    at: at,
                    durationMinutes: minutes,
                    location: location,
                    note: note
                )
                state = await model.currentState()

                if ok { booking = false }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .loading:
            Spacer()
            ProgressView().accessibilityLabel(L10n.string("common.loading"))
            Spacer()

        case .empty:
            MessageState(icon: "calendar", text: L10n.string("appointment.empty"))

        case .notFound:
            MessageState(icon: "questionmark.folder", text: L10n.string("home.noPatientFile"))

        case .failed(let message):
            MessageState(
                icon: Tokens.State.labCritical.iconName,
                text: message,
                retryTitle: L10n.string("common.retry")
            ) {
                await refresh { await model.refresh() }
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

                // The next one, first and large. It is what this screen is
                // opened to find, and a list somebody has to read to the middle
                // of is one they read wrong.
                if let next = state.next() {
                    NextAppointmentCard(appointment: next)
                }

                // Staff act on these; for a patient it is simply the state of
                // what they asked for.
                if !state.awaitingConfirmation.isEmpty {
                    Label(
                        "\(L10n.string("appointment.awaitingConfirmation")): \(state.awaitingConfirmation.count)",
                        systemImage: Tokens.State.triageUrgent.iconName
                    )
                    .font(Tokens.Typography.calloutRelative)
                    .foregroundStyle(Tokens.Palette.warning.resolve(for: scheme))
                }

                ForEach(state.appointments) { appointment in
                    AppointmentRow(
                        appointment: appointment,
                        canConfirm: canConfirm,
                        isWorking: state.working == appointment.id,
                        onConfirm: { await refresh { await model.confirm(appointment.id) } },
                        onCancel: { await refresh { await model.cancel(appointment.id, reason: nil) } }
                    )
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

struct NextAppointmentCard: View {
    @Environment(\.colorScheme) private var scheme

    let appointment: Appointment

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Text(L10n.string("appointment.next"))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            Text(appointment.type.localizedName)
                .font(Tokens.Typography.headingRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

            Text(appointment.scheduledAt.formatted(date: .complete, time: .shortened))
                .font(Tokens.Typography.bodyRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

            if let location = appointment.location {
                Text(location)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
        .padding(Tokens.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tokens.Palette.infoSurface.resolve(for: scheme))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .accessibilityElement(children: .combine)
    }
}

struct AppointmentRow: View {
    @Environment(\.colorScheme) private var scheme

    let appointment: Appointment
    let canConfirm: Bool
    let isWorking: Bool
    let onConfirm: () async -> Void
    let onCancel: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            HStack {
                Text(appointment.type.localizedName)
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                Spacer()

                // In words as well as colour: a colour a reader cannot
                // distinguish says nothing (spec section 7).
                Text(appointment.status.localizedName)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(tint.resolve(for: scheme))
            }

            Text(appointment.scheduledAt.formatted(date: .abbreviated, time: .shortened))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            if let reason = appointment.cancelledReason {
                Text(reason)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }

            if appointment.status.isUpcoming {
                HStack(spacing: Tokens.Spacing.md) {
                    if canConfirm && appointment.status == .requested {
                        Button(L10n.string("appointment.confirm")) { Task { await onConfirm() } }
                            .disabled(isWorking)
                            .frame(minHeight: Tokens.minimumTouchTarget)
                    }

                    Button(L10n.string("appointment.cancel"), role: .destructive) {
                        Task { await onCancel() }
                    }
                    .disabled(isWorking)
                    .frame(minHeight: Tokens.minimumTouchTarget)
                }
            }
        }
        .padding(.vertical, Tokens.Spacing.xs)
        .accessibilityElement(children: .combine)
    }

    private var tint: ThemedColor {
        switch appointment.status {
        case .confirmed: return Tokens.Palette.success
        case .requested: return Tokens.Palette.warning
        case .cancelled, .noShow: return Tokens.Palette.textSecondary
        case .completed: return Tokens.Palette.info
        }
    }
}


/// A URL the share sheet can be presented for. `URL` is not `Identifiable`, and
/// a sheet needs an identity to know when to present.
extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

#if os(iOS)
/// The system share sheet, for handing the calendar file to whichever app the
/// patient keeps their diary in.
struct ShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
#else
struct ShareSheet: View {
    let url: URL

    var body: some View { Text(url.lastPathComponent) }
}
#endif


/// The clinic putting an appointment in its own diary (spec M10).
struct BookAppointmentSheet: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    let submit: (AppointmentType, Date, Int, String?, String?) async -> Void

    @State private var type: AppointmentType = .control
    @State private var scheduledAt = Date().addingTimeInterval(86_400)
    @State private var minutes = 30
    @State private var location = ""
    @State private var note = ""
    @State private var busy = false

    var body: some View {
        FormScaffold(title: L10n.string("appointment.book")) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                    Text(L10n.string("appointment.type"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                    Picker(L10n.string("appointment.type"), selection: $type) {
                        ForEach(AppointmentType.allCases, id: \.self) { option in
                            Text(option.localizedName).tag(option)
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(minHeight: Tokens.minimumTouchTarget)
                }

                DatePicker(
                    L10n.string("appointment.when"),
                    selection: $scheduledAt,
                    displayedComponents: [.date, .hourAndMinute]
                )
                .font(Tokens.Typography.bodyRelative)
                .frame(minHeight: Tokens.minimumTouchTarget)

                Stepper(
                    "\(L10n.string("appointment.duration")): \(minutes) \(L10n.string("common.minutesShort"))",
                    value: $minutes,
                    in: 10...240,
                    step: 10
                )
                .font(Tokens.Typography.bodyRelative)
                .frame(minHeight: Tokens.minimumTouchTarget)

                LabelledField(
                    label: L10n.string("appointment.location"),
                    text: $location,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                LabelledField(
                    label: L10n.string("appointment.note"),
                    text: $note,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                PrimaryButton(
                    title: L10n.string("appointment.book"),
                    isBusy: busy,
                    isEnabled: !busy
                ) {
                    busy = true
                    await submit(
                        type,
                        scheduledAt,
                        minutes,
                        location.isEmpty ? nil : location,
                        note.isEmpty ? nil : note
                    )
                    busy = false
                }

                Button(L10n.string("common.cancel")) { dismiss() }
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
    }
}
