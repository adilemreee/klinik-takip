import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * A short survey, after surgery (spec M18).
 *
 * One question per card, large targets, no medical wording. The people filling
 * these in are recovering from an operation and often on painkillers; the spec
 * asks for a screen a person of any age can use (section 7), and a 0–10 slider
 * with no numbers under it is not one.
 *
 * The whole form is sent at once. Saving question by question would leave a
 * half-answered survey in the record, and an unanswered pain score is not the
 * same as a pain score of nothing.
 */
public struct SurveyScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: SurveyModel

    @State private var state = SurveyState()

    public init(model: SurveyModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                ErrorBanner(message: state.error)

                switch state.phase {
                case .loading:
                    SkeletonCard(lines: 4)
                        .accessibilityElement()
                        .accessibilityLabel(L10n.string("common.loading"))

                case .none:
                    MessageState(
                        icon: state.submitted ? "checkmark.circle" : "checklist",
                        text: state.submitted
                            ? L10n.string("survey.thanks")
                            : L10n.string("survey.nothingPending")
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
                    if let survey = state.current {
                        form(survey)
                    } else {
                        closedNotice
                    }
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("survey.title"))
        .task { await reload() }
    }

    private var closedNotice: some View {
        Card(tone: .info) {
            Text(L10n.string("survey.closed"))
                .font(Tokens.Typography.bodyRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func form(_ survey: PendingSurvey) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                Text(survey.title)
                    .font(Tokens.Typography.titleRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                    .accessibilityAddTraits(.isHeader)

                Text(
                    L10n.string("survey.milestone")
                        .replacingOccurrences(of: "{days}", with: "\(survey.milestoneDays)")
                )
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }

            if let description = survey.description {
                Text(description)
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)
            }

            ForEach(survey.questions) { question in
                QuestionCard(
                    question: question,
                    answer: state.answers[question.id]
                ) { answer in
                    model.answer(question.id, answer)
                    state = model.currentState()
                }
            }

            // Said before the button, not after: somebody should know where
            // their answers go before they give them.
            Text(L10n.string("survey.patientNote"))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                .fixedSize(horizontal: false, vertical: true)

            PrimaryButton(
                title: L10n.string("survey.submit"),
                isBusy: state.submitting,
                isEnabled: state.canSubmit && !state.submitting
            ) {
                await model.submit()
                state = model.currentState()
            }
        }
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}

/// One question, in the shape its type needs.
struct QuestionCard: View {
    @Environment(\.colorScheme) private var scheme

    let question: SurveyQuestion
    let answer: SurveyAnswer?
    let onAnswer: (SurveyAnswer) -> Void

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                Text(question.text)
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)

                switch question.type {
                case .scale0to10:
                    scale

                case .yesNo:
                    yesNo

                case .text:
                    freeText
                }
            }
        }
    }

    /**
     * Eleven buttons rather than a slider.
     *
     * A slider needs a steady hand and gives no feedback about which value is
     * selected until it is released. Numbered buttons can be hit by somebody on
     * painkillers, read by a screen reader, and answered by touching the number
     * they would have said out loud.
     */
    private var scale: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            LazyVGrid(
                columns: Array(
                    repeating: GridItem(.flexible(), spacing: Tokens.Spacing.xs),
                    count: 6
                ),
                spacing: Tokens.Spacing.xs
            ) {
                ForEach(0...10, id: \.self) { value in
                    Button {
                        onAnswer(.scale(value))
                    } label: {
                        Text("\(value)")
                            .font(Tokens.Typography.subheadingRelative)
                            .frame(
                                maxWidth: .infinity,
                                minHeight: Tokens.minimumTouchTarget
                            )
                            .foregroundStyle(
                                (isChosen(value)
                                    ? Tokens.Palette.accentText
                                    : Tokens.Palette.textPrimary).resolve(for: scheme)
                            )
                            .background(
                                (isChosen(value)
                                    ? Tokens.Palette.accent
                                    : Tokens.Palette.surface).resolve(for: scheme)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
                    }
                    .accessibilityLabel("\(value)")
                    .accessibilityAddTraits(isChosen(value) ? [.isButton, .isSelected] : .isButton)
                }
            }

            // Which end is which, in words. A bare 0–10 row means nothing
            // without knowing whether ten is good.
            HStack {
                Text(L10n.string(question.direction == .higherIsBetter ? "survey.worst" : "survey.none"))
                Spacer(minLength: Tokens.Spacing.sm)
                Text(L10n.string(question.direction == .higherIsBetter ? "survey.best" : "survey.worst"))
            }
            .font(Tokens.Typography.captionRelative)
            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
        }
    }

    private var yesNo: some View {
        HStack(spacing: Tokens.Spacing.md) {
            ForEach([true, false], id: \.self) { value in
                Button {
                    onAnswer(.yesNo(value))
                } label: {
                    Text(L10n.string(value ? "file.yes" : "file.no"))
                        .font(Tokens.Typography.subheadingRelative)
                        .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                        .foregroundStyle(
                            (isChosen(value)
                                ? Tokens.Palette.accentText
                                : Tokens.Palette.textPrimary).resolve(for: scheme)
                        )
                        .background(
                            (isChosen(value)
                                ? Tokens.Palette.accent
                                : Tokens.Palette.surface).resolve(for: scheme)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
                }
                .accessibilityAddTraits(isChosen(value) ? [.isButton, .isSelected] : .isButton)
            }
        }
    }

    private var freeText: some View {
        TextField(
            L10n.string("survey.textPlaceholder"),
            text: Binding(
                get: {
                    if case .text(let value) = answer { return value }
                    return ""
                },
                set: { onAnswer(.text($0)) }
            ),
            axis: .vertical
        )
        .textFieldStyle(.plain)
        .lineLimit(2...5)
        .padding(Tokens.Spacing.md)
        .frame(minHeight: Tokens.minimumTouchTarget)
        .background(Tokens.Palette.surface.resolve(for: scheme))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .accessibilityLabel(question.text)
    }

    private func isChosen(_ value: Int) -> Bool {
        if case .scale(let chosen) = answer { return chosen == value }
        return false
    }

    private func isChosen(_ value: Bool) -> Bool {
        if case .yesNo(let chosen) = answer { return chosen == value }
        return false
    }
}
