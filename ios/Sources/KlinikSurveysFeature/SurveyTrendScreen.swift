import Charts
import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * What a patient's answers say over time (spec M18).
 *
 * The findings come first, in words. A worsening trend is the whole reason the
 * spec asks for these surveys, and a clinician should not have to read a chart
 * to notice one — the server marks them, and they sit above the lines.
 */
public struct SurveyTrendScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: SurveyTrendModel

    @State private var phase: SurveyTrendPhase = .loading

    public init(model: SurveyTrendModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                switch phase {
                case .loading:
                    SkeletonCard(lines: 5)
                        .accessibilityElement()
                        .accessibilityLabel(L10n.string("common.loading"))

                case .empty:
                    MessageState(icon: "checklist", text: L10n.string("survey.noAnswers"))
                        .frame(minHeight: 320)

                case .failed(let message):
                    MessageState(
                        icon: Tokens.State.labCritical.iconName,
                        text: message,
                        retryTitle: L10n.string("common.retry")
                    ) {
                        await reload()
                    }

                case .loaded(let surveys):
                    findings(surveys)
                    charts(surveys)
                    answers(surveys)
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("survey.trendTitle"))
        .refreshable { await reload() }
        .task { await reload() }
    }

    @ViewBuilder
    private func findings(_ surveys: PatientSurveys) -> some View {
        if !surveys.latestFindings.isEmpty {
            Card(tone: .warning) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                    ForEach(surveys.latestFindings) { finding in
                        HStack(alignment: .top, spacing: Tokens.Spacing.sm) {
                            Image(systemName: Tokens.State.labCritical.iconName)
                                .foregroundStyle(Tokens.Palette.warning.resolve(for: scheme))
                                .accessibilityHidden(true)

                            VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                                Text(finding.questionText)
                                    .font(Tokens.Typography.subheadingRelative)
                                    .foregroundStyle(
                                        Tokens.Palette.textPrimary.resolve(for: scheme)
                                    )

                                Text(SurveyTrendScreen.describe(finding))
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

    @ViewBuilder
    private func charts(_ surveys: PatientSurveys) -> some View {
        if surveys.hasTrend {
            ForEach(surveys.template.questions.filter(\.isNumeric)) { question in
                let points = surveys.points(for: question.id)

                if points.count >= 2 {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                        SectionHeader(title: question.text)

                        Card {
                            Chart(points, id: \.point.id) { entry in
                                LineMark(
                                    x: .value(
                                        L10n.string("survey.milestone"),
                                        entry.point.milestoneDays
                                    ),
                                    y: .value(question.text, entry.value)
                                )
                                .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))

                                PointMark(
                                    x: .value(
                                        L10n.string("survey.milestone"),
                                        entry.point.milestoneDays
                                    ),
                                    y: .value(question.text, entry.value)
                                )
                                .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                            }
                            .chartYScale(domain: 0...10)
                            .chartYAxis { AxisMarks(position: .leading) }
                            .frame(height: 160)
                            .accessibilityLabel(question.text)
                        }
                    }
                }
            }
        } else {
            Card(tone: .info) {
                Text(L10n.string("survey.noTrend"))
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func answers(_ surveys: PatientSurveys) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(title: L10n.string("survey.title"))

            ForEach(surveys.series) { point in
                Card {
                    HStack(spacing: Tokens.Spacing.md) {
                        VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                            Text(
                                L10n.string("survey.milestone")
                                    .replacingOccurrences(
                                        of: "{days}",
                                        with: "\(point.milestoneDays)"
                                    )
                            )
                            .font(Tokens.Typography.subheadingRelative)
                            .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                            Text(
                                String(
                                    format: L10n.string("survey.answeredOn"),
                                    point.submittedAt.formatted(date: .abbreviated, time: .omitted)
                                )
                            )
                            .font(Tokens.Typography.captionRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        }

                        Spacer(minLength: Tokens.Spacing.sm)

                        // A partly answered survey is marked, because averaging
                        // over the questions somebody skipped would invent an
                        // answer they did not give.
                        if point.partial {
                            Badge(
                                L10n.string("survey.partialShort"),
                                tone: .warning,
                                symbol: "exclamationmark.circle"
                            )
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    /// The finding in a sentence, with the numbers that produced it.
    static func describe(_ finding: SurveyFinding) -> String {
        let kind = L10n.string("survey.finding.\(finding.kind.rawValue)")

        guard let previous = finding.previous else { return "\(kind): \(finding.value)" }

        return "\(kind): \(previous) → \(finding.value)"
    }

    private func reload() async {
        await model.load()
        phase = model.currentPhase()
    }
}
