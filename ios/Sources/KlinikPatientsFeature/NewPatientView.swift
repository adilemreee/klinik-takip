import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// Opening a patient file (spec M2).
public struct NewPatientView: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    private let model: NewPatientModel
    /// Told the new file's id, so the list behind can refresh or open it.
    private let onCreated: (String) -> Void

    @State private var firstName = ""
    @State private var lastName = ""
    @State private var birthDate = Calendar.current.date(
        byAdding: .year, value: -30, to: Date()
    ) ?? Date()
    @State private var sex = "FEMALE"
    @State private var country = "TR"
    @State private var city = ""
    @State private var referral = ""
    @State private var state = NewPatientState()

    private static let sexes = ["FEMALE", "MALE", "OTHER"]

    public init(model: NewPatientModel, onCreated: @escaping (String) -> Void) {
        self.model = model
        self.onCreated = onCreated
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                if let error = state.error {
                    ErrorBanner(message: error)
                }

                if case .created(let mrn, _) = state.phase {
                    created(mrn: mrn)
                } else {
                    form
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("patient.new"))
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
            field(L10n.string("patient.firstName"), text: $firstName)
            field(L10n.string("patient.lastName"), text: $lastName)

            DatePicker(
                L10n.string("patient.birthDate"),
                selection: $birthDate,
                // A birth date is never in the future, and a date picker that
                // allows one invites a typo nobody notices until an age is
                // calculated from it.
                in: ...Date(),
                displayedComponents: .date
            )
            .font(Tokens.Typography.bodyRelative)

            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                Text(L10n.string("patient.sex"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                Picker(L10n.string("patient.sex"), selection: $sex) {
                    ForEach(NewPatientView.sexes, id: \.self) { option in
                        Text(L10n.string("patient.sex.\(option)")).tag(option)
                    }
                }
                .pickerStyle(.segmented)
            }

            field(L10n.string("patient.countryHint"), text: $country)
            field(L10n.string("patient.cityHint"), text: $city)
            field(L10n.string("patient.referralHint"), text: $referral)

            Button(L10n.string("patient.create")) {
                Task { await save() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(state.phase == .saving)
            .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)

            if state.phase == .saving {
                HStack(spacing: Tokens.Spacing.md) {
                    ProgressView().accessibilityHidden(true)
                    Text(L10n.string("common.loading"))
                        .font(Tokens.Typography.captionRelative)
                }
            }
        }
    }

    /// The number, large, because somebody is about to write it down.
    private func created(mrn: String) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            Label(L10n.string("patient.created"), systemImage: "checkmark.circle")
                .font(Tokens.Typography.subheadingRelative)
                .foregroundStyle(Tokens.Palette.success.resolve(for: scheme))

            Text(L10n.string("patient.mrnAssigned"))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            Text(mrn)
                .font(Tokens.Typography.headingRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                .textSelection(.enabled)

            Button(L10n.string("common.close")) { dismiss() }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
        }
        .padding(Tokens.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tokens.Palette.infoSurface.resolve(for: scheme))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
    }

    private func field(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Text(label)
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            TextField(label, text: text)
                .textFieldStyle(.roundedBorder)
                .frame(minHeight: Tokens.minimumTouchTarget)
        }
    }

    private func save() async {
        await model.create(
            firstName: firstName,
            lastName: lastName,
            birthDate: birthDate,
            sex: sex,
            country: country,
            city: city,
            referralSource: referral
        )

        state = await model.currentState()

        if case .created(_, let id) = state.phase {
            onCreated(id)
        }
    }
}
