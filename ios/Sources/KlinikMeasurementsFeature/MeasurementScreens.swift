import Charts
import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// Which curve the chart is showing. Two axes with different units cannot share
/// one plot without one of them becoming unreadable, so they take turns.
public enum ChartSeries: String, CaseIterable, Sendable {
    case weight
    case bmi

    var titleKey: String { self == .weight ? "measurement.weight" : "measurement.bmi" }
}

public struct BodyChartView: View {
    @Environment(\.colorScheme) private var scheme

    private let model: MeasurementsModel
    private let canRecord: Bool

    @State private var state = MeasurementsState()
    @State private var series: ChartSeries = .weight
    @State private var recording = false

    /// - Parameter canRecord: staff without `medical.write` still read the
    ///   chart. Hiding the button they would be refused anyway is kinder than
    ///   showing them a 403.
    public init(model: MeasurementsModel, canRecord: Bool = true) {
        self.model = model
        self.canRecord = canRecord
    }

    public var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .task { await refresh { await model.load() } }
        .sheet(isPresented: $recording) {
            RecordMeasurementView(model: model) { await refresh { } }
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
            MessageState(
                icon: "chart.xyaxis.line",
                text: L10n.string("measurement.empty"),
                retryTitle: canRecord ? L10n.string("measurement.add") : nil,
                retry: canRecord ? { recording = true } : nil
            )

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

        case .loaded(let chart):
            loaded(chart)
        }
    }

    @ViewBuilder
    private func loaded(_ chart: BodyChart) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
            Picker("", selection: $series) {
                ForEach(ChartSeries.allCases, id: \.self) { option in
                    Text(L10n.string(option.titleKey)).tag(option)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityLabel(L10n.string("measurement.series"))

            curve(for: chart)
                .frame(height: 240)

            if series == .bmi, let latest = chart.bmi.last {
                BmiCategoryBadge(category: latest.category, value: latest.bmi)
            }

            LatestReadingSummary(chart: chart, series: series)

            Spacer()

            if canRecord {
                PrimaryButton(
                    title: L10n.string("measurement.add"),
                    isBusy: false,
                    isEnabled: !state.saving
                ) {
                    recording = true
                }
            }
        }
        .padding(Tokens.Spacing.lg)
    }

    /// The curve, with the clinic's goal drawn across it when one is set.
    @ViewBuilder
    private func curve(for chart: BodyChart) -> some View {
        Chart {
            if series == .weight {
                ForEach(chart.weight) { point in
                    LineMark(x: .value(L10n.string("measurement.date"), point.measuredAt),
                             y: .value(L10n.string("measurement.weight"), point.value))
                    PointMark(x: .value(L10n.string("measurement.date"), point.measuredAt),
                              y: .value(L10n.string("measurement.weight"), point.value))
                }
            } else {
                ForEach(chart.bmi) { point in
                    LineMark(x: .value(L10n.string("measurement.date"), point.measuredAt),
                             y: .value(L10n.string("measurement.bmi"), point.bmi))
                    PointMark(x: .value(L10n.string("measurement.date"), point.measuredAt),
                              y: .value(L10n.string("measurement.bmi"), point.bmi))
                }
            }

            if let target = goalLine(for: chart) {
                RuleMark(y: .value(L10n.string("measurement.target"), target))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                    .annotation(position: .top, alignment: .leading) {
                        Text(L10n.string("measurement.target"))
                            .font(Tokens.Typography.footnoteRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    }
            }
        }
        .chartYScale(domain: .automatic(includesZero: false))
        .accessibilityLabel(L10n.string(series.titleKey))
    }

    private func goalLine(for chart: BodyChart) -> Double? {
        series == .weight ? chart.targetWeightKg : chart.targetBmi
    }

    private func refresh(_ work: () async -> Void) async {
        await work()
        state = await model.currentState()
    }
}

/// The WHO band the latest BMI falls in, in words and colour.
///
/// Colour alone would not carry it: spec section 7 requires the meaning to
/// survive for a colour-blind reader, so the band is spelled out.
struct BmiCategoryBadge: View {
    @Environment(\.colorScheme) private var scheme

    let category: BmiCategory
    let value: Double

    var body: some View {
        HStack(spacing: Tokens.Spacing.sm) {
            Text(String(format: "%.1f", value))
                .font(Tokens.Typography.headingRelative)

            Text(category.localizedName)
                .font(Tokens.Typography.calloutRelative)
        }
        .foregroundStyle(tint.resolve(for: scheme))
        .padding(.horizontal, Tokens.Spacing.md)
        .padding(.vertical, Tokens.Spacing.sm)
        .background(surface.resolve(for: scheme))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .accessibilityElement(children: .combine)
    }

    private var tint: ThemedColor {
        switch category {
        case .normal: return Tokens.Palette.success
        case .underweight, .overweight: return Tokens.Palette.warning
        case .obeseI, .obeseII, .obeseIII: return Tokens.Palette.critical
        }
    }

    private var surface: ThemedColor {
        switch category {
        case .normal: return Tokens.Palette.successSurface
        case .underweight, .overweight: return Tokens.Palette.warningSurface
        case .obeseI, .obeseII, .obeseIII: return Tokens.Palette.criticalSurface
        }
    }
}

/// The most recent value in words, for anyone who cannot read the chart — a
/// plot is invisible to VoiceOver no matter how it is labelled.
struct LatestReadingSummary: View {
    @Environment(\.colorScheme) private var scheme

    let chart: BodyChart
    let series: ChartSeries

    var body: some View {
        Group {
            if let text = summary {
                Text(text)
                    .font(Tokens.Typography.calloutRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
    }

    private var summary: String? {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium

        if series == .weight, let last = chart.weight.last {
            return "\(L10n.string("measurement.latest")): \(String(format: "%.1f", last.value)) \(last.unit) — \(formatter.string(from: last.measuredAt))"
        }

        if series == .bmi, let last = chart.bmi.last {
            return "\(L10n.string("measurement.latest")): \(String(format: "%.1f", last.bmi)) — \(formatter.string(from: last.measuredAt))"
        }

        return nil
    }
}
