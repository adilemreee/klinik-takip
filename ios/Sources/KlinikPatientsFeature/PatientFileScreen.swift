import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * A patient's file (spec M2).
 *
 * The order is the order a clinician reads in, not the order the record is
 * stored in: who this is, what is wrong right now, what was done to them, how
 * they are doing, and only then the sections to go and look at. Anything that
 * needs somebody today is above the fold and carries a word as well as a
 * colour.
 *
 * The section rows at the bottom replace a list of bare words. "Tahliller"
 * tells a doctor nothing about whether to tap it; "Tahliller · 2 bekliyor"
 * does, and the counts come from the same read as everything else on the page
 * so they cannot disagree with it.
 */
public struct PatientFileScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: PatientFileModel
    private let onSection: (FileSection) -> Void
    /// Nil hides the invitation action rather than showing one that leads
    /// nowhere. The patient's own app has no use for it.
    private let onInvite: (() -> Void)?

    @State private var state = PatientFileState()
    @State private var editingIdentity = false
    @State private var editingMedical = false

    public init(
        model: PatientFileModel,
        onSection: @escaping (FileSection) -> Void,
        onInvite: (() -> Void)? = nil
    ) {
        self.model = model
        self.onSection = onSection
        self.onInvite = onInvite
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                ErrorBanner(message: state.savingError)

                switch state.phase {
                case .loading:
                    VStack(spacing: Tokens.Spacing.lg) {
                        SkeletonCard(lines: 3)
                        SkeletonCard(lines: 5)
                        SkeletonCard(lines: 4)
                    }
                    .accessibilityElement()
                    .accessibilityLabel(L10n.string("common.loading"))

                case .notFound:
                    MessageState(icon: "questionmark.circle", text: L10n.string("error.notFound"))
                        .frame(minHeight: 320)

                case .failed(let message):
                    MessageState(
                        icon: Tokens.State.labCritical.iconName,
                        text: message,
                        retryTitle: L10n.string("common.retry")
                    ) {
                        await reload()
                    }

                case .loaded(let file):
                    identity(file)

                    if file.alerts.any { alerts(file.alerts) }

                    medical(file)
                    surgery(file)
                    readings(file)
                    adherence(file)
                    conversation(file)
                    upcoming(file)
                    team(file)
                    sections(file)
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .refreshable { await reload() }
        .task { await reload() }
        .sheet(isPresented: $editingIdentity) {
            if let file = state.file {
                EditIdentitySheet(file: file) { edit in
                    let ok = await model.save(edit)
                    state = model.currentState()
                    if ok { editingIdentity = false }
                }
            }
        }
        .sheet(isPresented: $editingMedical) {
            if let file = state.file {
                EditMedicalSheet(profile: file.medicalProfile) { edit in
                    let ok = await model.save(edit)
                    state = model.currentState()
                    if ok { editingMedical = false }
                }
            }
        }
    }

    // MARK: - Who this is

    private func identity(_ file: PatientFile) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                HStack(spacing: Tokens.Spacing.md) {
                    InitialsAvatar(name: file.patient.fullName, diameter: 56)

                    VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                        Text(file.patient.fullName)
                            .font(Tokens.Typography.headingRelative)
                            .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                        Text("\(L10n.string("patient.fileNumber")) \(file.patient.mrn)")
                            .font(Tokens.Typography.captionRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    }

                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .combine)

                HStack(spacing: Tokens.Spacing.sm) {
                    Badge(
                        file.patient.localizedStatus,
                        tone: PatientFileScreen.tone(for: file.patient.status),
                        symbol: "person.text.rectangle"
                    )
                    Badge(file.patient.localizedSex, symbol: "person")
                    Badge(
                        String(format: L10n.string("patient.ageYears"), file.patient.age),
                        symbol: "calendar"
                    )

                    Spacer(minLength: 0)
                }

                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), alignment: .topLeading),
                        GridItem(.flexible(), alignment: .topLeading),
                    ],
                    spacing: Tokens.Spacing.md
                ) {
                    FieldRow(
                        label: L10n.string("patient.birthDate"),
                        value: file.patient.birthDate.formatted(date: .abbreviated, time: .omitted)
                    )
                    FieldRow(
                        label: L10n.string("patient.countryHint"),
                        value: [file.patient.country, file.patient.city]
                            .compactMap { $0 }
                            .joined(separator: " · ")
                    )
                    FieldRow(
                        label: L10n.string("file.language"),
                        value: file.patient.preferredLanguage.localizedUppercase
                    )
                    FieldRow(
                        label: L10n.string("file.nationality"),
                        value: file.patient.nationality
                    )
                    FieldRow(label: L10n.string("file.phone"), value: file.contact.phone)
                    FieldRow(label: L10n.string("file.email"), value: file.contact.email)
                    FieldRow(
                        label: L10n.string("file.referral"),
                        value: file.patient.referralSource
                    )
                    FieldRow(
                        label: L10n.string("file.registered"),
                        value: file.patient.createdAt.formatted(date: .abbreviated, time: .omitted)
                    )
                }

                Button(L10n.string("file.editPatient")) { editingIdentity = true }
                    .font(Tokens.Typography.calloutRelative)
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))

                // Only while there is no login. A file whose patient already
                // uses the app does not need an invitation, and offering one
                // would issue a code nobody has a use for.
                if !file.contact.hasAccount, let onInvite {
                    Button(L10n.string("menu.invite")) { onInvite() }
                        .font(Tokens.Typography.subheadingRelative)
                        .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                        .foregroundStyle(Tokens.Palette.accentText.resolve(for: scheme))
                        .background(Tokens.Palette.accent.resolve(for: scheme))
                        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
                }
            }
        }
    }

    // MARK: - What needs somebody today

    private func alerts(_ alerts: FileAlerts) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(title: L10n.string("file.alerts"))

            Card(tone: alerts.openEmergency || alerts.criticalLabs > 0 ? .critical : .warning) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                    if alerts.openEmergency {
                        alertRow(L10n.string("file.openEmergency"), count: nil, tone: .critical)
                    }
                    if alerts.criticalLabs > 0 {
                        alertRow(
                            L10n.string("file.criticalLabs"),
                            count: alerts.criticalLabs,
                            tone: .critical
                        )
                    }
                    if alerts.openComplications > 0 {
                        alertRow(
                            L10n.string("file.openComplications"),
                            count: alerts.openComplications,
                            tone: .warning
                        )
                    }
                    if alerts.labsAwaitingReview > 0 {
                        alertRow(
                            L10n.string("file.labsAwaiting"),
                            count: alerts.labsAwaitingReview,
                            tone: .warning
                        )
                    }
                    if alerts.unreviewedReports > 0 {
                        alertRow(
                            L10n.string("file.unreviewedReports"),
                            count: alerts.unreviewedReports,
                            tone: .info
                        )
                    }
                }
            }
        }
    }

    private func alertRow(_ title: String, count: Int?, tone: Tone) -> some View {
        HStack(spacing: Tokens.Spacing.sm) {
            Image(systemName: tone.iconName)
                .foregroundStyle(tone.foreground.resolve(for: scheme))
                // The title beside it carries the meaning; the icon is there so
                // the row is not distinguished by colour alone.
                .accessibilityHidden(true)

            Text(title)
                .font(Tokens.Typography.bodyRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

            Spacer(minLength: Tokens.Spacing.sm)

            if let count {
                Text("\(count)")
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(tone.foreground.resolve(for: scheme))
            }
        }
        .frame(minHeight: Tokens.minimumTouchTarget)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Medical

    private func medical(_ file: PatientFile) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(
                title: L10n.string("file.medical"),
                actionTitle: L10n.string("common.edit")
            ) {
                editingMedical = true
            }

            if let profile = file.medicalProfile, !profile.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                        // Allergies first and tinted: it is the field that
                        // changes what somebody may safely give this patient.
                        FieldRow(
                            label: L10n.string("file.allergies"),
                            value: profile.allergies.isEmpty
                                ? L10n.string("file.no")
                                : profile.allergies.joined(separator: ", "),
                            tone: profile.allergies.isEmpty ? .neutral : .critical
                        )

                        LazyVGrid(
                            columns: [
                                GridItem(.flexible(), alignment: .topLeading),
                                GridItem(.flexible(), alignment: .topLeading),
                            ],
                            spacing: Tokens.Spacing.md
                        ) {
                            FieldRow(
                                label: L10n.string("file.bloodType"),
                                value: profile.bloodType
                            )
                            FieldRow(
                                label: L10n.string("file.targetWeight"),
                                value: profile.targetWeightKg.map { "\($0) kg" }
                            )
                            FieldRow(
                                label: L10n.string("file.smoking"),
                                value: PatientFileScreen.yesNo(profile.smoking)
                            )
                            FieldRow(
                                label: L10n.string("file.alcohol"),
                                value: PatientFileScreen.yesNo(profile.alcohol)
                            )
                        }

                        FieldRow(
                            label: L10n.string("file.chronic"),
                            value: profile.chronicConditions.isEmpty
                                ? L10n.string("file.no")
                                : profile.chronicConditions.joined(separator: ", ")
                        )

                        if !profile.currentMedications.isEmpty {
                            FieldRow(
                                label: L10n.string("file.currentMedications"),
                                value: profile.currentMedications.joined(separator: ", ")
                            )
                        }

                        if let notes = profile.notes, !notes.isEmpty {
                            FieldRow(label: L10n.string("file.notes"), value: notes)
                        }
                    }
                }
            } else {
                Card(tone: .warning) {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                        Text(L10n.string("file.noMedicalProfile"))
                            .font(Tokens.Typography.bodyRelative)
                            .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                            .fixedSize(horizontal: false, vertical: true)

                        Button(L10n.string("file.fillMedicalProfile")) { editingMedical = true }
                            .font(Tokens.Typography.subheadingRelative)
                            .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                            .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func surgery(_ file: PatientFile) -> some View {
        if let surgery = file.lastSurgery {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(title: L10n.string("file.surgery"))

                Card {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                        Text(surgery.procedureName)
                            .font(Tokens.Typography.subheadingRelative)
                            .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                        HStack(spacing: Tokens.Spacing.sm) {
                            Badge(
                                surgery.performedAt.formatted(date: .abbreviated, time: .omitted),
                                tone: .info,
                                symbol: "calendar"
                            )
                            Badge(String(format: L10n.string("file.daysAgo"), surgery.daysAgo))

                            Spacer(minLength: 0)
                        }

                        if surgery.surgeonName != nil || surgery.location != nil {
                            LazyVGrid(
                                columns: [
                                    GridItem(.flexible(), alignment: .topLeading),
                                    GridItem(.flexible(), alignment: .topLeading),
                                ],
                                spacing: Tokens.Spacing.md
                            ) {
                                FieldRow(label: "Cerrah", value: surgery.surgeonName)
                                FieldRow(label: "Yer", value: surgery.location)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - How they are doing

    @ViewBuilder
    private func readings(_ file: PatientFile) -> some View {
        if !file.latestMeasurements.isEmpty {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(
                    title: L10n.string("file.latestMeasurements"),
                    actionTitle: L10n.string("common.showMore")
                ) {
                    onSection(.measurements)
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Tokens.Spacing.md) {
                        ForEach(file.latestMeasurements) { reading in
                            StatTile(
                                value: reading.reading,
                                label: reading.type.localizedName,
                                symbol: "waveform.path.ecg"
                            )
                            .frame(width: 150)
                        }
                    }
                    .padding(.horizontal, 1)
                }
            }
        }
    }

    @ViewBuilder
    private func adherence(_ file: PatientFile) -> some View {
        if let adherence = file.adherence {
            Card(tone: adherence.needsAttention ? .warning : .neutral) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                    HStack {
                        Text(L10n.string("file.adherence"))
                            .font(Tokens.Typography.subheadingRelative)
                            .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                        Spacer(minLength: Tokens.Spacing.sm)

                        if let percent = adherence.percent {
                            Text("%\(percent)")
                                .font(Tokens.Typography.titleRelative)
                                .foregroundStyle(
                                    (adherence.needsAttention
                                        ? Tokens.Palette.warning
                                        : Tokens.Palette.success).resolve(for: scheme)
                                )
                        }
                    }

                    Text(
                        String(
                            format: L10n.string("file.adherenceOf"),
                            adherence.activeMedications,
                            adherence.taken,
                            adherence.missed
                        )
                    )
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                    HStack(spacing: Tokens.Spacing.sm) {
                        if adherence.streak > 0 {
                            Badge(
                                String(format: L10n.string("file.streak"), adherence.streak),
                                tone: .success,
                                symbol: "flame"
                            )
                        }

                        // The spec's automatic warning below 70% (M9) — said in
                        // words, not only by the tint on the number.
                        if adherence.needsAttention {
                            Badge(
                                L10n.string("file.adherenceLow"),
                                tone: .warning,
                                symbol: "exclamationmark.circle"
                            )
                        }

                        Spacer(minLength: 0)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func conversation(_ file: PatientFile) -> some View {
        if let message = file.lastMessage {
            Button { onSection(.messages) } label: {
                Card(tone: file.unreadMessages > 0 ? .info : .neutral) {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                        HStack(spacing: Tokens.Spacing.sm) {
                            Text(L10n.string("file.lastMessage"))
                                .font(Tokens.Typography.captionRelative)
                                .foregroundStyle(
                                    Tokens.Palette.textSecondary.resolve(for: scheme)
                                )

                            Spacer(minLength: Tokens.Spacing.sm)

                            if file.unreadMessages > 0 {
                                Badge(
                                    String(
                                        format: L10n.string("file.unread"),
                                        file.unreadMessages
                                    ),
                                    tone: .info,
                                    symbol: "envelope.badge"
                                )
                            }
                        }

                        Text(message.body ?? L10n.string("message.attachment"))
                            .font(Tokens.Typography.bodyRelative)
                            .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                            .lineLimit(3)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)

                        Text(
                            "\(message.fromPatient ? L10n.string("file.fromPatient") : L10n.string("file.fromClinic")) · \(message.sentAt.formatted(date: .abbreviated, time: .shortened))"
                        )
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    }
                }
            }
            .buttonStyle(.plain)
            .frame(minHeight: Tokens.minimumTouchTarget)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
        }
    }

    @ViewBuilder
    private func upcoming(_ file: PatientFile) -> some View {
        if file.nextAppointment != nil || file.nextFollowUp != nil {
            HStack(spacing: Tokens.Spacing.md) {
                if let appointment = file.nextAppointment {
                    StatTile(
                        value: appointment.scheduledAt.formatted(date: .abbreviated, time: .shortened),
                        label: L10n.string("file.nextAppointment"),
                        tone: .info,
                        symbol: "calendar.badge.clock"
                    )
                }

                if let followUp = file.nextFollowUp {
                    StatTile(
                        value: followUp.dueAt.formatted(date: .abbreviated, time: .omitted),
                        label: "\(L10n.string("file.nextFollowUp")) · \(followUp.label)",
                        tone: .info,
                        symbol: "checkmark.circle"
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func team(_ file: PatientFile) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(title: L10n.string("file.team"))

            Card {
                if file.assignments.isEmpty {
                    Text(L10n.string("file.noTeam"))
                        .font(Tokens.Typography.bodyRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                } else {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                        ForEach(file.assignments) { member in
                            HStack(spacing: Tokens.Spacing.md) {
                                InitialsAvatar(name: member.name, diameter: 36)

                                VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                                    Text([member.title, member.name]
                                        .compactMap { $0 }
                                        .joined(separator: " "))
                                        .font(Tokens.Typography.bodyRelative)
                                        .foregroundStyle(
                                            Tokens.Palette.textPrimary.resolve(for: scheme)
                                        )

                                    Text(member.localizedRole)
                                        .font(Tokens.Typography.captionRelative)
                                        .foregroundStyle(
                                            Tokens.Palette.textSecondary.resolve(for: scheme)
                                        )
                                }

                                Spacer(minLength: 0)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Where to go next

    private func sections(_ file: PatientFile) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(title: L10n.string("file.sections"))

            Card {
                VStack(spacing: 0) {
                    ForEach(Array(FileSection.allCases.enumerated()), id: \.element) { index, section in
                        if index > 0 { Divider() }

                        let badge = file.badge(for: section)

                        NavigationRow(
                            symbol: PatientFileScreen.symbol(for: section),
                            title: L10n.string(section.titleKey),
                            badge: badge?.text,
                            badgeTone: badge?.urgent == true ? .warning : .neutral
                        ) {
                            onSection(section)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    static func yesNo(_ value: Bool?) -> String {
        guard let value else { return L10n.string("file.unknown") }

        return value ? L10n.string("file.yes") : L10n.string("file.no")
    }

    static func tone(for status: String) -> Tone {
        switch status {
        case "POST_OP", "PRE_OP": return .warning
        case "FOLLOW_UP", "SCHEDULED": return .info
        case "DISCHARGED": return .success
        default: return .neutral
        }
    }

    static func symbol(for section: FileSection) -> String {
        switch section {
        case .messages: return "bubble.left.and.bubble.right"
        case .measurements: return "chart.xyaxis.line"
        case .medications: return "pills"
        case .documents: return "doc.text"
        case .labReview: return "checkmark.seal"
        case .labTrend: return "testtube.2"
        case .photos: return "photo.on.rectangle"
        case .followUp: return "calendar.badge.checkmark"
        case .appointments: return "calendar"
        case .surveys: return "checklist"
        }
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}

extension FileSection {
    /// The menu labels the app already has, reused so one section is not called
    /// two different things in two places.
    var titleKey: String {
        switch self {
        case .messages: return "menu.messages"
        case .measurements: return "menu.measurements"
        case .medications: return "menu.medications"
        case .documents: return "menu.documents"
        case .labReview: return "menu.labReview"
        case .labTrend: return "menu.labResults"
        case .photos: return "menu.photos"
        case .followUp: return "menu.followUp"
        case .appointments: return "menu.appointments"
        case .surveys: return "menu.surveyTrend"
        }
    }
}
