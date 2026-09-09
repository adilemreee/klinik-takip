import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * The clinic's FAQ assistant (spec M4).
 *
 * Deliberately not styled as a chat with a personality. It answers from the
 * clinic's own documents and nothing else, and the screen says so under every
 * answer: the sources it used, the warning that this is not a diagnosis, and a
 * button that takes the question to a person. The spec requires that button
 * under every bot answer, and it is the reason this screen is safe to offer at
 * all — nobody is ever left with only a machine's reply.
 *
 * A handover is rendered as what it is: the question has already gone to the
 * clinic. It is not an error and must not look like one.
 */
public struct AssistantScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: AssistantModel
    private let openConversation: () -> Void

    @State private var state = AssistantState()
    @State private var question = ""

    public init(model: AssistantModel, openConversation: @escaping () -> Void) {
        self.model = model
        self.openConversation = openConversation
    }

    public var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                        if state.turns.isEmpty { introduction }

                        ForEach(state.turns) { turn in
                            self.turn(turn).id(turn.id)
                        }
                    }
                    .padding(Tokens.Spacing.lg)
                }
                .onChange(of: state.turns.count) { _, _ in
                    if let last = state.turns.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }

            composer
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("assistant.title"))
    }

    /// What the assistant is, before anybody has asked anything. Said plainly,
    /// because a patient who expects a doctor and gets a bot stops trusting the
    /// app rather than the bot.
    private var introduction: some View {
        Card(tone: .info) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                HStack(spacing: Tokens.Spacing.sm) {
                    Image(systemName: "text.bubble")
                        .font(Tokens.Typography.headingRelative)
                        .foregroundStyle(Tokens.Palette.info.resolve(for: scheme))
                        .accessibilityHidden(true)

                    Text(L10n.string("assistant.title"))
                        .font(Tokens.Typography.subheadingRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                }

                Text(L10n.string("assistant.intro"))
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)

                Button(L10n.string("assistant.openConversation")) { openConversation() }
                    .font(Tokens.Typography.calloutRelative)
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
            }
        }
    }

    @ViewBuilder
    private func turn(_ turn: AssistantTurn) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            // The question, aligned right the way a sent message is.
            HStack {
                Spacer(minLength: Tokens.Spacing.xxl)

                Text(turn.question)
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tokens.Palette.accentText.resolve(for: scheme))
                    .padding(Tokens.Spacing.md)
                    .background(Tokens.Palette.accent.resolve(for: scheme))
                    .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.lg))
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let failure = turn.failure {
                ErrorBanner(message: failure)
            } else if let result = turn.result {
                answer(turn, result)
            } else {
                HStack(spacing: Tokens.Spacing.sm) {
                    ProgressView().accessibilityLabel(L10n.string("common.loading"))

                    Text(L10n.string("common.loading"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }
            }
        }
    }

    private func answer(_ turn: AssistantTurn, _ result: AssistantResult) -> some View {
        Card(tone: result.answered ? .neutral : .info) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                Text(result.displayText)
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)

                if !result.sources.isEmpty {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                        ForEach(result.sources, id: \.self) { source in
                            Label(
                                "\(L10n.string("assistant.sourcePrefix")): \(source)",
                                systemImage: "doc.text"
                            )
                            .font(Tokens.Typography.footnoteRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        }
                    }
                }

                if result.answered {
                    // Required under every bot answer (spec M4).
                    Text(L10n.string("assistant.disclaimer"))
                        .font(Tokens.Typography.footnoteRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }

                if turn.canEscalate {
                    Button(L10n.string("assistant.notEnough")) {
                        Task {
                            await model.escalate(turn.id)
                            state = model.currentState()
                        }
                    }
                    .font(Tokens.Typography.calloutRelative)
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                    .disabled(state.escalatingId == turn.id)
                } else if turn.escalated {
                    Label(L10n.string("assistant.sent"), systemImage: "checkmark.circle.fill")
                        .font(Tokens.Typography.calloutRelative)
                        .foregroundStyle(Tokens.Palette.success.resolve(for: scheme))
                }
            }
        }
    }

    private var composer: some View {
        VStack(spacing: Tokens.Spacing.sm) {
            if case .failed(let message) = state.phase {
                ErrorBanner(message: message)
            }

            HStack(spacing: Tokens.Spacing.sm) {
                TextField(L10n.string("assistant.placeholder"), text: $question, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...4)
                    .padding(Tokens.Spacing.md)
                    .frame(minHeight: Tokens.minimumTouchTarget)
                    .background(Tokens.Palette.surface.resolve(for: scheme))
                    .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
                    .accessibilityLabel(L10n.string("assistant.placeholder"))

                Button {
                    let asked = question
                    question = ""

                    Task {
                        await model.ask(asked)
                        state = model.currentState()
                    }
                } label: {
                    Label(L10n.string("common.send"), systemImage: "arrow.up.circle.fill")
                        .labelStyle(.iconOnly)
                        .font(Tokens.Typography.titleRelative)
                        .frame(width: Tokens.minimumTouchTarget, height: Tokens.minimumTouchTarget)
                        .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                }
                .disabled(
                    state.phase == .asking
                        || question.trimmingCharacters(in: .whitespaces).isEmpty
                )
                .accessibilityLabel(L10n.string("common.send"))
            }
        }
        .padding(Tokens.Spacing.lg)
        .background(Tokens.Palette.surfaceRaised.resolve(for: scheme))
    }
}
