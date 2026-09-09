import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// A yes/no the record is allowed not to know.
///
/// A plain `Toggle` cannot say "nobody asked": off and "does not smoke" would
/// be the same pixel, and a clinician reading the card could not tell an
/// answered question from an unasked one.
enum Tristate: String, CaseIterable, Identifiable {
    case unknown
    case yes
    case no

    var id: String { rawValue }

    /// Written as an if/else rather than a `switch` over `Bool?`: whether that
    /// switch is exhaustive depends on the toolchain, and it compiled here and
    /// failed in CI.
    init(_ value: Bool?) {
        guard let value else {
            self = .unknown
            return
        }

        self = value ? .yes : .no
    }

    var value: Bool? {
        switch self {
        case .unknown: return nil
        case .yes: return true
        case .no: return false
        }
    }

    var localizedName: String {
        switch self {
        case .unknown: return L10n.string("file.unknown")
        case .yes: return L10n.string("file.yes")
        case .no: return L10n.string("file.no")
        }
    }
}

/// Demographics and where the patient is in their treatment.
struct EditIdentitySheet: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    let file: PatientFile
    let submit: (PatientEdit) async -> Void

    @State private var firstName: String
    @State private var lastName: String
    @State private var city: String
    @State private var language: String
    @State private var status: String
    @State private var sex: String
    @State private var busy = false

    init(file: PatientFile, submit: @escaping (PatientEdit) async -> Void) {
        self.file = file
        self.submit = submit
        _firstName = State(initialValue: file.patient.firstName)
        _lastName = State(initialValue: file.patient.lastName)
        _city = State(initialValue: file.patient.city ?? "")
        _language = State(initialValue: file.patient.preferredLanguage)
        _status = State(initialValue: file.patient.status)
        _sex = State(initialValue: file.patient.sex)
    }

    private static let statuses = [
        "LEAD", "SCHEDULED", "PRE_OP", "POST_OP", "FOLLOW_UP", "DISCHARGED", "INACTIVE",
    ]
    private static let sexes = ["FEMALE", "MALE", "OTHER"]
    private static let languages = ["tr", "en"]

    var body: some View {
        FormScaffold(
            title: L10n.string("file.editPatient"),
            subtitle: file.patient.fullName
        ) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                LabelledField(
                    label: L10n.string("patient.firstName"),
                    text: $firstName,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                LabelledField(
                    label: L10n.string("patient.lastName"),
                    text: $lastName,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                LabelledField(
                    label: L10n.string("patient.cityHint"),
                    text: $city,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                labelled(L10n.string("patient.sex")) {
                    Picker(L10n.string("patient.sex"), selection: $sex) {
                        ForEach(EditIdentitySheet.sexes, id: \.self) { value in
                            Text(L10n.string("patient.sex.\(value)")).tag(value)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                labelled(L10n.string("file.language")) {
                    Picker(L10n.string("file.language"), selection: $language) {
                        ForEach(EditIdentitySheet.languages, id: \.self) { value in
                            Text(value.localizedUppercase).tag(value)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                labelled(L10n.string("patient.status.LEAD")) {
                    Picker(L10n.string("patient.status.LEAD"), selection: $status) {
                        ForEach(EditIdentitySheet.statuses, id: \.self) { value in
                            Text(L10n.string("patient.status.\(value)")).tag(value)
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(minHeight: Tokens.minimumTouchTarget)
                }

                PrimaryButton(
                    title: L10n.string("common.save"),
                    isBusy: busy,
                    isEnabled: !firstName.trimmed.isEmpty && !lastName.trimmed.isEmpty
                ) {
                    busy = true
                    await submit(edit)
                    busy = false
                }

                Button(L10n.string("common.cancel")) { dismiss() }
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
    }

    /// Only what changed, plus the version that was read. A field left alone is
    /// not sent, so an edit cannot overwrite something with a stale copy of it.
    private var edit: PatientEdit {
        PatientEdit(
            firstName: firstName.trimmed == file.patient.firstName ? nil : firstName.trimmed,
            lastName: lastName.trimmed == file.patient.lastName ? nil : lastName.trimmed,
            sex: sex == file.patient.sex ? nil : sex,
            city: city.trimmed == (file.patient.city ?? "") ? nil : city.trimmed,
            preferredLanguage: language == file.patient.preferredLanguage ? nil : language,
            status: status == file.patient.status ? nil : status,
            expectedVersion: file.patient.version
        )
    }

    @ViewBuilder
    private func labelled<Content: View>(
        _ label: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Text(label)
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            content()
        }
    }
}

/// Allergies, chronic conditions and the rest of what M2 calls the medical card.
struct EditMedicalSheet: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    let profile: MedicalProfile?
    let submit: (MedicalProfileEdit) async -> Void

    @State private var bloodType: String
    @State private var allergies: String
    @State private var chronic: String
    @State private var medications: String
    @State private var targetWeight: String
    @State private var notes: String
    @State private var smoking: Tristate
    @State private var alcohol: Tristate
    @State private var busy = false

    init(profile: MedicalProfile?, submit: @escaping (MedicalProfileEdit) async -> Void) {
        self.profile = profile
        self.submit = submit
        _bloodType = State(initialValue: profile?.bloodType ?? "")
        _allergies = State(initialValue: (profile?.allergies ?? []).joined(separator: ", "))
        _chronic = State(initialValue: (profile?.chronicConditions ?? []).joined(separator: ", "))
        _medications = State(
            initialValue: (profile?.currentMedications ?? []).joined(separator: ", ")
        )
        _targetWeight = State(initialValue: profile?.targetWeightKg ?? "")
        _notes = State(initialValue: profile?.notes ?? "")
        _smoking = State(initialValue: Tristate(profile?.smoking))
        _alcohol = State(initialValue: Tristate(profile?.alcohol))
    }

    var body: some View {
        FormScaffold(
            title: L10n.string("file.medical"),
            subtitle: L10n.string("file.commaSeparated")
        ) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                LabelledField(
                    label: L10n.string("file.bloodType"),
                    text: $bloodType,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                LabelledField(
                    label: L10n.string("file.allergies"),
                    text: $allergies,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                LabelledField(
                    label: L10n.string("file.chronic"),
                    text: $chronic,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                LabelledField(
                    label: L10n.string("file.currentMedications"),
                    text: $medications,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                LabelledField(
                    label: L10n.string("file.targetWeight"),
                    text: $targetWeight,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .decimal
                )

                tristate(L10n.string("file.smoking"), selection: $smoking)
                tristate(L10n.string("file.alcohol"), selection: $alcohol)

                LabelledField(
                    label: L10n.string("file.notes"),
                    text: $notes,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                PrimaryButton(
                    title: L10n.string("common.save"),
                    isBusy: busy,
                    isEnabled: true
                ) {
                    busy = true
                    await submit(edit)
                    busy = false
                }

                Button(L10n.string("common.cancel")) { dismiss() }
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
    }

    private var edit: MedicalProfileEdit {
        MedicalProfileEdit(
            bloodType: bloodType.trimmed.isEmpty ? nil : bloodType.trimmed,
            allergies: EditMedicalSheet.list(allergies),
            chronicConditions: EditMedicalSheet.list(chronic),
            currentMedications: EditMedicalSheet.list(medications),
            smoking: smoking.value,
            alcohol: alcohol.value,
            targetWeightKg: EditMedicalSheet.weight(targetWeight),
            notes: notes.trimmed.isEmpty ? nil : notes.trimmed,
            expectedVersion: profile?.version
        )
    }

    /// Splits on commas and drops what is left over. Somebody typing
    /// "penisilin, , lateks" means two allergies, not three.
    static func list(_ text: String) -> [String] {
        text
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    /// Accepts both separators: a Turkish keyboard produces a comma, and a
    /// field that silently refuses it reads as broken.
    static func weight(_ text: String) -> Double? {
        let normalised = text
            .trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: ",", with: ".")

        guard !normalised.isEmpty else { return nil }

        return Double(normalised)
    }

    @ViewBuilder
    private func tristate(_ label: String, selection: Binding<Tristate>) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Text(label)
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            Picker(label, selection: selection) {
                ForEach(Tristate.allCases) { option in
                    Text(option.localizedName).tag(option)
                }
            }
            .pickerStyle(.segmented)
        }
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
