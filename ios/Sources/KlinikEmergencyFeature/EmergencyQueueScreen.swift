import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * The staff side of the emergency button (spec M8).
 *
 * The spec asks for the patient's location and last clinical summary to be *on
 * the screen* when a call comes in, and that is the whole design: somebody
 * answering a call at two in the morning should not have to open a file to
 * find out that this patient is on anticoagulants. Everything needed to make
 * the first decision is in the card; the file is one tap away for the rest.
 */
public struct EmergencyQueueScreen: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.openURL) private var openURL

    private let model: EmergencyQueueModel
    private let openFile: (String, String) -> Void

    @State private var state = EmergencyQueueState()
    @State private var resolving: StaffEmergencyView?

    public init(
        model: EmergencyQueueModel,
        openFile: @escaping (String, String) -> Void
    ) {
        self.model = model
        self.openFile = openFile
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                ErrorBanner(message: state.actionError)

                switch state.phase {
                case .loading:
                    VStack(spacing: Tokens.Spacing.lg) {
                        SkeletonCard(lines: 5)
                        SkeletonCard(lines: 5)
                    }
                    .accessibilityElement()
                    .accessibilityLabel(L10n.string("common.loading"))

                case .empty:
                    MessageState(
                        icon: "checkmark.circle",
                        text: L10n.string("emergency.queueEmpty")
                    )
                    .frame(minHeight: 320)

                case .failed(let message):
                    MessageState(
                        icon: Tokens.State.labCritical.iconName,
                        text: message,
                        retryTitle: L10n.string("common.retry")
                    ) {
                        await reload()
                    }

                case .loaded:
                    ForEach(state.calls) { call in
                        callCard(call)
                    }
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("emergency.queueTitle"))
        .refreshable { await reload() }
        .task { await reload() }
        .sheet(item: $resolving) { call in
            ResolveSheet(call: call) { note, falseAlarm in
                await model.resolve(call.id, note: note, falseAlarm: falseAlarm)
                state = model.currentState()

                if state.actionError == nil { resolving = nil }
            }
        }
    }

    private func callCard(_ call: StaffEmergencyView) -> some View {
        Card(tone: call.unanswered ? .critical : .warning) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                header(call)
                snapshot(call.summary)

                if let note = call.event.note, !note.isEmpty {
                    FieldRow(label: L10n.string("emergency.patientNote"), value: note)
                }

                contact(call)
                actions(call)
            }
        }
    }

    private func header(_ call: StaffEmergencyView) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            HStack(spacing: Tokens.Spacing.md) {
                InitialsAvatar(name: call.summary.fullName)

                VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                    Text(call.summary.fullName)
                        .font(Tokens.Typography.headingRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                    Text(EmergencyQueueScreen.identityLine(call.summary))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }

                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)

            // Wrapped rather than in a row: three badges plus a long waiting
            // string overflows at large text sizes.
            HStack(spacing: Tokens.Spacing.sm) {
                if call.unanswered {
                    Badge(
                        L10n.string("emergency.unanswered"),
                        tone: .critical,
                        symbol: "bell.badge.fill"
                    )
                } else if call.event.status == .acknowledged {
                    Badge(
                        L10n.string("emergency.acknowledged"),
                        tone: .success,
                        symbol: "person.fill.checkmark"
                    )
                }

                if call.event.escalationLevel > 0 {
                    Badge(
                        String(
                            format: L10n.string("emergency.escalation"),
                            call.event.escalationLevel
                        ),
                        tone: .warning,
                        symbol: "arrow.up.right"
                    )
                }

                Badge(
                    String(format: L10n.string("emergency.waitingMinutes"), call.waitingMinutes),
                    tone: call.waitingMinutes >= 5 ? .critical : .neutral,
                    symbol: "clock"
                )

                Spacer(minLength: 0)
            }
        }
    }

    /// The snapshot the spec asks to be on screen when the call is answered.
    private func snapshot(_ summary: EmergencySummary) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            Text(L10n.string("emergency.snapshot"))
                .font(Tokens.Typography.subheadingRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

            LazyVGrid(
                columns: [
                    GridItem(.flexible(), alignment: .topLeading),
                    GridItem(.flexible(), alignment: .topLeading),
                ],
                spacing: Tokens.Spacing.md
            ) {
                FieldRow(label: L10n.string("emergency.bloodType"), value: summary.bloodType)

                FieldRow(
                    label: L10n.string("emergency.lastSurgery"),
                    value: summary.lastSurgery.map {
                        "\($0.procedureName) · \(String(format: L10n.string("emergency.daysAgo"), $0.daysAgo))"
                    }
                )

                // Allergies are the one field on this card that changes what
                // somebody may safely give the patient, so they are tinted and
                // the label says what they are — never colour alone.
                FieldRow(
                    label: L10n.string("emergency.allergies"),
                    value: summary.allergies.isEmpty
                        ? L10n.string("emergency.none")
                        : summary.allergies.joined(separator: ", "),
                    tone: summary.allergies.isEmpty ? .neutral : .critical
                )

                FieldRow(
                    label: L10n.string("emergency.chronic"),
                    value: summary.chronicConditions.isEmpty
                        ? L10n.string("emergency.none")
                        : summary.chronicConditions.joined(separator: ", ")
                )
            }

            if !summary.currentMedications.isEmpty {
                FieldRow(
                    label: L10n.string("emergency.currentMedications"),
                    value: summary.currentMedications.joined(separator: ", ")
                )
            }
        }
    }

    private func contact(_ call: StaffEmergencyView) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            if let phone = call.summary.phone, let url = URL(string: "tel://\(phone)") {
                Button {
                    openURL(url)
                } label: {
                    Label(
                        String(format: L10n.string("emergency.callPatientAt"), phone),
                        systemImage: "phone.fill"
                    )
                    .font(Tokens.Typography.subheadingRelative)
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.accentText.resolve(for: scheme))
                    .background(Tokens.Palette.success.resolve(for: scheme))
                    .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
                }
            }

            if let url = EmergencyQueueScreen.mapURL(for: call.event) {
                Button {
                    openURL(url)
                } label: {
                    Label(L10n.string("emergency.openLocation"), systemImage: "mappin.and.ellipse")
                        .font(Tokens.Typography.calloutRelative)
                        .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                        .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                }
            } else {
                Text(L10n.string("emergency.locationUnknown"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
    }

    private func actions(_ call: StaffEmergencyView) -> some View {
        VStack(spacing: Tokens.Spacing.sm) {
            if call.event.status == .triggered {
                PrimaryButton(
                    title: L10n.string("emergency.acknowledgeAction"),
                    isBusy: state.busyId == call.id,
                    isEnabled: state.busyId == nil
                ) {
                    await model.acknowledge(call.id)
                    state = model.currentState()
                }
            }

            HStack(spacing: Tokens.Spacing.sm) {
                Button(L10n.string("emergency.openFile")) {
                    openFile(call.summary.patientId, call.summary.fullName)
                }
                .font(Tokens.Typography.calloutRelative)
                .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))

                Button(L10n.string("emergency.resolveAction")) { resolving = call }
                    .font(Tokens.Typography.calloutRelative)
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
    }

    // MARK: - Helpers

    static func identityLine(_ summary: EmergencySummary) -> String {
        var parts = [summary.mrn]

        if let age = summary.age {
            parts.append(String(format: L10n.string("patient.ageYears"), age))
        }

        parts.append(summary.country)

        return parts.joined(separator: " · ")
    }

    /// Apple Maps, with the coordinates as a pin. Nil when the device had no
    /// fix when the button was pressed, which is common and not an error.
    static func mapURL(for event: EmergencyEvent) -> URL? {
        guard let latitude = event.latitude, let longitude = event.longitude else { return nil }

        return URL(string: "https://maps.apple.com/?ll=\(latitude),\(longitude)&q=\(latitude),\(longitude)")
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}

/// Closing a call needs a sentence about how it ended; the sheet exists so the
/// note is written while the call is fresh rather than backfilled later.
struct ResolveSheet: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    let call: StaffEmergencyView
    let submit: (String, Bool) async -> Void

    @State private var note = ""
    @State private var falseAlarm = false
    @State private var busy = false

    var body: some View {
        FormScaffold(
            title: L10n.string("emergency.resolveAction"),
            subtitle: call.summary.fullName
        ) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                LabelledField(
                    label: L10n.string("emergency.resolutionRequired"),
                    text: $note,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                Toggle(L10n.string("emergency.falseAlarm"), isOn: $falseAlarm)
                    .font(Tokens.Typography.bodyRelative)
                    .frame(minHeight: Tokens.minimumTouchTarget)

                PrimaryButton(
                    title: L10n.string("emergency.resolveAction"),
                    isBusy: busy,
                    isEnabled: !note.trimmingCharacters(in: .whitespaces).isEmpty
                ) {
                    busy = true
                    await submit(note, falseAlarm)
                    busy = false
                }

                Button(L10n.string("common.cancel")) { dismiss() }
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
    }
}
