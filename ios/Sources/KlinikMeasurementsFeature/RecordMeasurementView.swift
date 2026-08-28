import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// Entering a reading.
///
/// Presented as a sheet from the chart rather than as its own screen: the
/// number that was just typed belongs next to the curve it changes.
public struct RecordMeasurementView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    private let model: MeasurementsModel
    private let onSaved: () async -> Void

    @State private var type: MeasurementType = .weight
    @State private var value = ""
    @State private var secondaryValue = ""
    @State private var note = ""
    @State private var state = MeasurementsState()

    public init(model: MeasurementsModel, onSaved: @escaping () async -> Void) {
        self.model = model
        self.onSaved = onSaved
    }

    public var body: some View {
        FormScaffold(title: L10n.string("measurement.add")) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                Picker(L10n.string("measurement.type"), selection: $type) {
                    ForEach(MeasurementType.allCases, id: \.self) { option in
                        Text(option.localizedName).tag(option)
                    }
                }
                .accessibilityLabel(L10n.string("measurement.type"))

                LabelledField(
                    label: primaryLabel,
                    text: $value,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .decimal
                )

                if type.hasSecondaryValue {
                    LabelledField(
                        label: L10n.string("measurement.diastolic"),
                        text: $secondaryValue,
                        isSecure: false,
                        contentType: .plain,
                        keyboard: .decimal
                    )
                }

                LabelledField(
                    label: L10n.string("measurement.note"),
                    text: $note,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                if let error = state.saveError {
                    ErrorBanner(message: error)
                }

                PrimaryButton(
                    title: L10n.string("common.save"),
                    isBusy: state.saving,
                    isEnabled: canSave,
                    action: save
                )
            }
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
    }

    /// Systolic for blood pressure, the reading's own name otherwise — so the
    /// two blood-pressure fields are never two identically labelled boxes.
    private var primaryLabel: String {
        type.hasSecondaryValue ? L10n.string("measurement.systolic") : type.localizedName
    }

    private var canSave: Bool {
        guard DecimalEntry.parse(value) != nil else { return false }
        if type.hasSecondaryValue { return DecimalEntry.parse(secondaryValue) != nil }
        return true
    }

    private func save() async {
        guard let parsed = DecimalEntry.parse(value) else { return }

        let saved = await model.record(
            NewMeasurement(
                type: type,
                value: parsed,
                secondaryValue: type.hasSecondaryValue ? DecimalEntry.parse(secondaryValue) : nil,
                note: note.isEmpty ? nil : note
            )
        )

        state = await model.currentState()

        // The sheet stays open when the server refused the value, so the
        // number is still there to correct rather than typed again from
        // memory.
        if saved {
            await onSaved()
            dismiss()
        }
    }
}
