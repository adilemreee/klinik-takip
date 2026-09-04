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
