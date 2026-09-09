import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * The clinician's medication screen (spec M9).
 *
 * Three groups, in the order they need a decision: what the patient added and
 * nobody has approved yet — inert until somebody does, so it sits at the top —
 * then the active plan, then what has been stopped, kept because a course
 * somebody came off is part of the record.
 *
 * The interaction warnings are above the list rather than behind a button, and
 * they say when nothing was compared. An empty warning list next to two
 * unrecognised drug names is not a clean bill of health, and letting it read
 * as one is how software misleads a clinician.
 */
public struct PrescribingScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: PrescribingModel

    @State private var state = PrescribingState()
    @State private var writing = false
    @State private var stopping: MedicationView?

    public init(model: PrescribingModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                ErrorBanner(message: state.error)

                switch state.phase {
                case .loading:
                    VStack(spacing: Tokens.Spacing.lg) {
                        SkeletonCard(lines: 4)
                        SkeletonCard(lines: 4)
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

                case .empty:
                    interactions

                    MessageState(icon: "pills", text: L10n.string("medication.empty"))
                        .frame(minHeight: 200)

                case .loaded:
                    interactions

                    group(
                        L10n.string("medication.awaitingApproval"),
                        state.awaitingApproval,
                        tone: .warning
                    )
                    group(L10n.string("medication.prescribed"), state.active, tone: .neutral)
                    group(L10n.string("medication.stopped"), state.stopped, tone: .neutral)
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("medication.staffTitle"))
        .refreshable { await reload() }
        .task { await reload() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    writing = true
                } label: {
                    Label(L10n.string("prescribe.title"), systemImage: "plus")
                }
                .frame(minHeight: Tokens.minimumTouchTarget)
            }
        }
        .sheet(isPresented: $writing) {
            PrescribeSheet { prescription in
                let ok = await model.prescribe(prescription)
                state = model.currentState()
                if ok { writing = false }
            }
        }
        .confirmationDialog(
            L10n.string("medication.stopConfirm"),
            isPresented: .constant(stopping != nil),
            titleVisibility: .visible
        ) {
            Button(L10n.string("medication.stopAction"), role: .destructive) {
                if let medication = stopping {
                    Task {
                        await model.stop(medication.id)
                        state = model.currentState()
                        stopping = nil
                    }
                }
            }

            Button(L10n.string("common.cancel"), role: .cancel) { stopping = nil }
        } message: {
            if let medication = stopping {
                Text(medication.medication.drugName)
            }
        }
    }

    // MARK: - Interactions

    @ViewBuilder
    private var interactions: some View {
        if let check = state.interactions, !check.warnings.isEmpty || !check.unrecognised.isEmpty {
            Card(tone: check.hasSevere ? .critical : .warning) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                    Text(L10n.string("medication.interactionsTitle"))
                        .font(Tokens.Typography.subheadingRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                    ForEach(Array(check.warnings.enumerated()), id: \.offset) { _, warning in
                        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                            HStack(spacing: Tokens.Spacing.sm) {
                                Badge(
                                    warning.severity.localizedName,
                                    tone: warning.severity.isSevere ? .critical : .warning,
                                    symbol: Tokens.State.labCritical.iconName
                                )

                                Text(warning.between.map(\.drugName).joined(separator: " + "))
                                    .font(Tokens.Typography.calloutRelative)
                                    .foregroundStyle(
                                        Tokens.Palette.textPrimary.resolve(for: scheme)
                                    )

                                Spacer(minLength: 0)
                            }

                            Text(warning.note)
                                .font(Tokens.Typography.captionRelative)
                                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .accessibilityElement(children: .combine)
                    }

                    if !check.unrecognised.isEmpty {
                        FieldRow(
                            label: L10n.string("interaction.unrecognised"),
                            value: check.unrecognised.map(\.drugName).joined(separator: ", "),
                            tone: .warning
                        )
                    }

                    // The reference is partial and says so. A warning nobody
                    // gave is not a safety claim.
                    Text(L10n.string("interaction.disclaimer"))
                        .font(Tokens.Typography.footnoteRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // MARK: - The plan

    @ViewBuilder
    private func group(_ title: String, _ items: [MedicationView], tone: Tone) -> some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(title: title, subtitle: "\(items.count)")

                ForEach(items) { item in
                    card(item, tone: tone)
                }
            }
        }
    }

    private func card(_ item: MedicationView, tone: Tone) -> some View {
        Card(tone: tone) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                HStack(alignment: .firstTextBaseline, spacing: Tokens.Spacing.sm) {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                        Text(item.medication.drugName)
                            .font(Tokens.Typography.subheadingRelative)
                            .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                        Text([item.medication.dose, item.medication.form]
                            .compactMap { $0 }
                            .joined(separator: " · "))
                            .font(Tokens.Typography.captionRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    }

                    Spacer(minLength: 0)

                    if item.medication.source == .patientReported {
                        Badge(
                            L10n.string("medication.patientReported"),
                            tone: .info,
                            symbol: "person.crop.circle"
                        )
                    }
                }
                .accessibilityElement(children: .combine)

                // The rule in a sentence, written by the server from the rule
                // it actually stored — not re-derived here, where it could
                // describe something the server did not save.
                FieldRow(label: L10n.string("prescribe.timesPerDay"), value: item.schedule)

                if let instructions = item.medication.instructions, !instructions.isEmpty {
                    FieldRow(label: L10n.string("prescribe.instructions"), value: instructions)
                }

                HStack(spacing: Tokens.Spacing.sm) {
                    if let percentage = item.adherence.percentage {
                        Badge(
                            "%\(percentage)",
                            tone: percentage < 70 ? .warning : .success,
                            symbol: "chart.bar"
                        )
                    }

                    Badge(
                        String(
                            format: L10n.string("medication.adherenceOf"),
                            item.adherence.taken,
                            item.adherence.missed
                        )
                    )

                    Spacer(minLength: 0)
                }

                if let next = item.nextDose, item.medication.isActive {
                    FieldRow(
                        label: L10n.string("medication.nextDose"),
                        value: next.formatted(date: .abbreviated, time: .shortened)
                    )
                }

                actions(item)
            }
        }
    }

    @ViewBuilder
    private func actions(_ item: MedicationView) -> some View {
        HStack(spacing: Tokens.Spacing.sm) {
            if item.medication.awaitingApproval {
                PrimaryButton(
                    title: L10n.string("medication.approveAction"),
                    isBusy: state.busyId == item.id,
                    isEnabled: state.busyId == nil
                ) {
                    await model.approve(item.id)
                    state = model.currentState()
                }
            }

            if item.medication.stoppedAt == nil {
                Button(L10n.string("medication.stopAction")) { stopping = item }
                    .font(Tokens.Typography.calloutRelative)
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.critical.resolve(for: scheme))
                    .disabled(state.busyId != nil)
            }
        }
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}

/**
 * Writing a plan.
 *
 * Two questions, not an RRULE: how many times a day, and for how long. The
 * sentence under the form says what those two produce, because sixteen
 * notifications on somebody's phone is not a thing to get wrong quietly.
 */
struct PrescribeSheet: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    let submit: (Prescription) async -> Void

    @State private var drugName = ""
    @State private var dose = ""
    @State private var form = ""
    @State private var instructions = ""
    @State private var timesPerDay = 2
    @State private var days = 7
    @State private var startDate = Date()
    @State private var busy = false

    private var schedule: Schedule {
        Schedule(timesPerDay: timesPerDay, days: days)
    }

    var body: some View {
        FormScaffold(title: L10n.string("prescribe.title")) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                LabelledField(
                    label: L10n.string("prescribe.drugName"),
                    text: $drugName,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                LabelledField(
                    label: L10n.string("prescribe.dose"),
                    text: $dose,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                LabelledField(
                    label: L10n.string("prescribe.form"),
                    text: $form,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                    Text(L10n.string("prescribe.timesPerDay"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                    Picker(L10n.string("prescribe.timesPerDay"), selection: $timesPerDay) {
                        ForEach(1...4, id: \.self) { count in
                            Text("\(count)").tag(count)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Stepper(
                    "\(L10n.string("prescribe.days")): \(days)",
                    value: $days,
                    in: 1...180
                )
                .font(Tokens.Typography.bodyRelative)
                .frame(minHeight: Tokens.minimumTouchTarget)

                DatePicker(
                    L10n.string("prescribe.startDate"),
                    selection: $startDate,
                    displayedComponents: .date
                )
                .font(Tokens.Typography.bodyRelative)
                .frame(minHeight: Tokens.minimumTouchTarget)

                // What the two answers above actually produce.
                Card(tone: .info) {
                    Text(schedule.summary)
                        .font(Tokens.Typography.calloutRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }

                LabelledField(
                    label: L10n.string("prescribe.instructions"),
                    text: $instructions,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                PrimaryButton(
                    title: L10n.string("prescribe.action"),
                    isBusy: busy,
                    isEnabled: !drugName.trimmed.isEmpty && !dose.trimmed.isEmpty
                ) {
                    busy = true
                    await submit(prescription)
                    busy = false
                }

                Button(L10n.string("common.cancel")) { dismiss() }
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
    }

    private var prescription: Prescription {
        Prescription(
            drugName: drugName.trimmed,
            dose: dose.trimmed,
            form: form.trimmed.isEmpty ? nil : form.trimmed,
            frequencyRule: schedule.rule,
            startDate: startDate,
            startTime: schedule.startTime,
            timezone: TimeZone.current.identifier,
            instructions: instructions.trimmed.isEmpty ? nil : instructions.trimmed
        )
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
