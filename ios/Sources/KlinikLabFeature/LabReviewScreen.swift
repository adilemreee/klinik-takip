import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// The doctor's review queue.
///
/// Every row here is a number OCR read and nobody has checked. The screen says
/// so, because a list that looks like results is a list that gets approved
/// without being read.
public struct LabReviewScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: LabReviewModel

    @State private var state = LabReviewState()
    @State private var editing: LabReviewItem?

    public init(model: LabReviewModel) {
        self.model = model
    }

    public var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .task { await refresh { await model.load() } }
        .sheet(item: $editing) { item in
            LabCorrectionSheet(item: item) { correction in
                await refresh { await model.confirm(item.id, correction: correction) }
                editing = nil
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
            MessageState(icon: "checkmark.circle", text: L10n.string("lab.review.empty"))

        case .notFound:
            MessageState(icon: "questionmark.folder", text: L10n.string("error.notFound"))

        case .failed(let message):
            MessageState(
                icon: Tokens.State.labCritical.iconName,
                text: message,
                retryTitle: L10n.string("common.retry")
            ) {
                await refresh { await model.load() }
            }

        case .loaded:
            queue
        }
    }

    private var queue: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            // Said outright, at the top, every time. A reviewer who forgets what
            // this list is will approve it like a report.
            Text(L10n.string("lab.review.notice"))
                .font(Tokens.Typography.calloutRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                .padding(.horizontal, Tokens.Spacing.lg)
                .padding(.top, Tokens.Spacing.lg)

            if let error = state.error {
                ErrorBanner(message: error).padding(.horizontal, Tokens.Spacing.lg)
            }

            List {
                ForEach(state.items) { item in
                    LabReviewRow(item: item, isWorking: state.working == item.id) {
                        await refresh { await model.confirm(item.id) }
                    } onEdit: {
                        editing = item
                    } onDiscard: {
                        await refresh { await model.discard(item.id) }
                    }
                }
            }
            .listStyle(.plain)
        }
    }

    private func refresh(_ work: () async -> Void) async {
        await work()
        state = await model.currentState()
    }
}

struct LabReviewRow: View {
    @Environment(\.colorScheme) private var scheme

    let item: LabReviewItem
    let isWorking: Bool
    let onConfirm: () async -> Void
    let onEdit: () -> Void
    let onDiscard: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            HStack {
                Text(item.result.analyteName)
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                Spacer()

                if let flag = item.result.flag {
                    FlagBadge(flag: flag)
                }
            }

            Text(valueLine)
                .font(Tokens.Typography.bodyRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

            // The two reasons a row needs a human, spelled out rather than
            // signalled by colour alone (spec section 7).
            if item.needsAttention {
                Label(L10n.string("lab.review.lowConfidence"), systemImage: "eye.trianglebadge.exclamationmark")
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.warning.resolve(for: scheme))
            }

            if item.awaitingMapping {
                Label(L10n.string("lab.review.needsMapping"), systemImage: "questionmark.circle")
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.info.resolve(for: scheme))
            }

            HStack(spacing: Tokens.Spacing.md) {
                Button(L10n.string("lab.review.confirm")) { Task { await onConfirm() } }
                    .disabled(isWorking)
                    .frame(minHeight: Tokens.minimumTouchTarget)

                Button(L10n.string("lab.review.correct"), action: onEdit)
                    .disabled(isWorking)
                    .frame(minHeight: Tokens.minimumTouchTarget)

                Spacer()

                Button(L10n.string("lab.review.discard"), role: .destructive) {
                    Task { await onDiscard() }
                }
                .disabled(isWorking)
                .frame(minHeight: Tokens.minimumTouchTarget)
            }
        }
        .padding(.vertical, Tokens.Spacing.xs)
    }

    private var valueLine: String {
        let reference = item.result.referenceText.map { " (\($0))" } ?? ""
        return "\(item.result.value) \(item.result.unit)\(reference)"
    }
}

/// A flag in words as well as colour — colour alone carries nothing for a
/// colour-blind reader (spec section 7).
struct FlagBadge: View {
    @Environment(\.colorScheme) private var scheme

    let flag: LabFlag

    var body: some View {
        Text(flag.localizedName)
            .font(Tokens.Typography.footnoteRelative)
            .foregroundStyle(tint.resolve(for: scheme))
            .padding(.horizontal, Tokens.Spacing.sm)
            .padding(.vertical, Tokens.Spacing.xxs)
            .background(surface.resolve(for: scheme))
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.sm))
    }

    private var tint: ThemedColor {
        switch flag {
        case .normal: return Tokens.Palette.success
        case .low, .high: return Tokens.Palette.warning
        case .critical: return Tokens.Palette.critical
        }
    }

    private var surface: ThemedColor {
        switch flag {
        case .normal: return Tokens.Palette.successSurface
        case .low, .high: return Tokens.Palette.warningSurface
        case .critical: return Tokens.Palette.criticalSurface
        }
    }
}

/// Correcting a row before confirming it.
struct LabCorrectionSheet: View {
    @Environment(\.colorScheme) private var scheme

    let item: LabReviewItem
    let onSave: (LabCorrection) async -> Void

    @State private var analyteName: String = ""
    @State private var analyteCode: String = ""
    @State private var value: String = ""
    @State private var unit: String = ""
    @State private var refLow: String = ""
    @State private var refHigh: String = ""

    var body: some View {
        FormScaffold(
            title: L10n.string("lab.review.correct"),
            // The line OCR read, so the reviewer corrects against the report
            // rather than against their memory of it.
            subtitle: item.result.analyteName
        ) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                field("lab.field.analyteName", $analyteName, keyboard: .default)
                field("lab.field.analyteCode", $analyteCode, keyboard: .default)
                field("lab.field.value", $value, keyboard: .decimal)
                field("lab.field.unit", $unit, keyboard: .default)
                field("lab.field.refLow", $refLow, keyboard: .decimal)
                field("lab.field.refHigh", $refHigh, keyboard: .decimal)

                PrimaryButton(
                    title: L10n.string("lab.review.confirm"),
                    isBusy: false,
                    isEnabled: true
                ) {
                    await onSave(correction)
                }
            }
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .onAppear {
            analyteName = item.result.analyteName
            analyteCode = item.result.analyteCode ?? ""
            value = item.result.value
            unit = item.result.unit
            refLow = item.result.refLow ?? ""
            refHigh = item.result.refHigh ?? ""
        }
    }

    private func field(
        _ key: String,
        _ text: Binding<String>,
        keyboard: FieldKeyboard
    ) -> some View {
        LabelledField(
            label: L10n.string(key),
            text: text,
            isSecure: false,
            contentType: .plain,
            keyboard: keyboard
        )
    }

    /// Only what actually changed is sent, so an untouched field cannot
    /// overwrite the stored value with a re-parsed version of itself.
    private var correction: LabCorrection {
        LabCorrection(
            analyteName: changed(analyteName, item.result.analyteName),
            analyteCode: changed(analyteCode, item.result.analyteCode ?? ""),
            value: number(value, original: item.result.value),
            unit: changed(unit, item.result.unit),
            refLow: number(refLow, original: item.result.refLow ?? ""),
            refHigh: number(refHigh, original: item.result.refHigh ?? "")
        )
    }

    private func changed(_ current: String, _ original: String) -> String? {
        let trimmed = current.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty || trimmed == original ? nil : trimmed
    }

    private func number(_ current: String, original: String) -> Double? {
        guard let text = changed(current, original) else { return nil }
        return Double(text.replacingOccurrences(of: ",", with: "."))
    }
}
