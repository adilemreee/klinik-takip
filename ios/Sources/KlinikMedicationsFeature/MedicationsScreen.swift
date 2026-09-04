import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// The patient's medications and today's check-in (spec M9).
public struct MedicationsScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: MedicationsModel

    @State private var state = MedicationsState()

    public init(model: MedicationsModel) {
        self.model = model
    }

    public var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("medication.title"))
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
            MessageState(icon: "pills", text: L10n.string("medication.empty"))

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

                if let overall = state.overall {
                    AdherenceCard(adherence: overall, badges: state.badges)
                }

                if !state.today.isEmpty {
                    Text(L10n.string("medication.today"))
                        .font(Tokens.Typography.subheadingRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                    ForEach(state.today) { dose in
                        DoseRow(
                            dose: dose,
                            medication: state.medication(for: dose),
                            isWorking: state.working == dose.id
                        ) { action, minutes in
                            await refresh {
                                await model.checkIn(dose.id, action: action, snoozeMinutes: minutes)
                            }
                        }
                    }
                }

                if !state.medications.isEmpty {
                    Divider()

                    ForEach(state.medications) { entry in
                        MedicationRow(entry: entry)
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

/**
 * The adherence score, or an honest absence of one.
 *
 * A course with nothing due yet has no score. Drawing that as 0% would tell a
 * patient on their first morning that they are already failing, which is the
 * opposite of what an adherence screen is for (spec M9).
 */
struct AdherenceCard: View {
    @Environment(\.colorScheme) private var scheme

    let adherence: Adherence
    let badges: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Text(L10n.string("medication.adherence"))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            if let percentage = adherence.percentage {
                Text("%\(percentage)")
                    .font(Tokens.Typography.headingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
            } else {
                Text(L10n.string("medication.noScoreYet"))
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }

            if adherence.streak > 0 {
                Text("\(L10n.string("medication.streak")): \(adherence.streak)")
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }

            // The server withholds these while a course is going badly — the
            // tone rule from M9. Whatever arrives is shown; nothing is invented
            // here to fill the space.
            ForEach(badges, id: \.self) { badge in
                Text(L10n.string("medication.badge.\(badge)"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.success.resolve(for: scheme))
            }
        }
        .padding(Tokens.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tokens.Palette.infoSurface.resolve(for: scheme))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .accessibilityElement(children: .combine)
    }
}

struct DoseRow: View {
    @Environment(\.colorScheme) private var scheme

    let dose: DoseLog
    let medication: Medication?
    let isWorking: Bool
    let onCheckIn: (MedicationsAPI.CheckInAction, Int?) async -> Void

    /// Long enough to be a real "not now", short enough to still be today.
    private static let snoozeMinutes = 30

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            HStack {
                Text(medication?.drugName ?? L10n.string("medication.title"))
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                Spacer()

                // In words as well as colour: a colour a reader cannot
                // distinguish says nothing (spec section 7).
                Text(dose.status.localizedName)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(tint.resolve(for: scheme))
            }

            if let dosage = medication?.dose {
                Text(dosage)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }

            Text(dose.scheduledAt, style: .time)
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            if dose.status.isOpen {
                HStack(spacing: Tokens.Spacing.md) {
                    Button(L10n.string("medication.taken")) {
                        Task { await onCheckIn(.taken, nil) }
                    }
                    .disabled(isWorking)
                    .frame(minHeight: Tokens.minimumTouchTarget)

                    Button(L10n.string("medication.snooze")) {
                        Task { await onCheckIn(.snooze, DoseRow.snoozeMinutes) }
                    }
                    .disabled(isWorking)
                    .frame(minHeight: Tokens.minimumTouchTarget)

                    Button(L10n.string("medication.skipped")) {
                        Task { await onCheckIn(.skipped, nil) }
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
        switch dose.status {
        case .taken: return Tokens.Palette.success
        case .late: return Tokens.Palette.warning
        case .skipped: return Tokens.Palette.textSecondary
        case .pending, .snoozed: return Tokens.Palette.info
        }
    }
}

struct MedicationRow: View {
    @Environment(\.colorScheme) private var scheme

    let entry: MedicationView

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Text(entry.medication.drugName)
                .font(Tokens.Typography.subheadingRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

            Text("\(entry.medication.dose) · \(entry.schedule)")
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            // A medication the patient added themselves does nothing until a
            // clinician approves it. Saying so is the difference between "the
            // clinic knows" and "the clinic has been told".
            if entry.medication.awaitingApproval {
                Label(
                    L10n.string("medication.awaitingApproval"),
                    systemImage: Tokens.State.triageUrgent.iconName
                )
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.warning.resolve(for: scheme))
            }

            if entry.medication.stoppedAt != nil {
                Text(L10n.string("medication.stopped"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }

            if let next = entry.nextDose, entry.medication.isActive {
                Text("\(L10n.string("medication.nextDose")): \(next.formatted(date: .omitted, time: .shortened))")
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
        .padding(.vertical, Tokens.Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}
