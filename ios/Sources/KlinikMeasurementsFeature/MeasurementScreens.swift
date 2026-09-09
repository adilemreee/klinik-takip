import Charts
import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// Which curve the chart is showing. Two axes with different units cannot share
/// one plot without one of them becoming unreadable, so they take turns.
public enum ChartSeries: String, CaseIterable, Sendable, Identifiable {
    case weight
    case bmi
    case bloodPressure
    case pulse
    case temperature
    case spo2
    case glucose
    case waist

    public var id: String { rawValue }

    /// The two the composed body chart carries; the rest are fetched one at a
    /// time, because a doctor reading a fever curve is not also reading a
    /// weight and plotting both would make neither legible.
    var isBodyChart: Bool { self == .weight || self == .bmi }

    var measurementType: MeasurementType? {
        switch self {
        case .weight: return .weight
        case .bmi: return nil
        case .bloodPressure: return .bloodPressure
        case .pulse: return .pulse
        case .temperature: return .temperature
        case .spo2: return .spo2
        case .glucose: return .glucose
        case .waist: return .waist
        }
    }

    var titleKey: String {
        switch self {
        case .weight: return "measurement.weight"
        case .bmi: return "measurement.bmi"
        default: return "measurement.type.\(measurementType?.rawValue ?? "")"
        }
    }
}

public struct BodyChartView: View {
    @Environment(\.colorScheme) private var scheme

    private let model: MeasurementsModel
    private let canRecord: Bool
    /// Pulling readings off the phone's health store (spec M20). Nil on the
    /// staff side and on a device with no health data, which leaves the button
    /// out rather than showing one that cannot work.
    private let syncFromDevice: (() async -> String?)?

    @State private var state = MeasurementsState()
    @State private var series: ChartSeries = .weight
    /// Fetched per kind, because only weight and BMI arrive with the composed
    /// body chart.
    @State private var otherSeries: [MeasurementPoint] = []
    @State private var recording = false
    @State private var syncing = false
    @State private var syncMessage: String?

    /// - Parameter canRecord: staff without `medical.write` still read the
    ///   chart. Hiding the button they would be refused anyway is kinder than
    ///   showing them a 403.
    public init(
        model: MeasurementsModel,
        canRecord: Bool = true,
        syncFromDevice: (() async -> String?)? = nil
    ) {
        self.model = model
        self.canRecord = canRecord
        self.syncFromDevice = syncFromDevice
    }

    public var body: some View {
        VStack(spacing: 0) {
            if let syncMessage {
                Text(syncMessage)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Tokens.Spacing.md)
                    .background(Tokens.Palette.infoSurface.resolve(for: scheme))
            }

            content

            if let syncFromDevice {
                Button {
                    Task {
                        syncing = true
                        syncMessage = await syncFromDevice()
                        syncing = false
                        await refresh { await model.load() }
                    }
                } label: {
                    if syncing {
                        ProgressView().accessibilityLabel(L10n.string("health.syncing"))
                    } else {
                        Label(L10n.string("health.sync"), systemImage: "heart.text.square")
                            .font(Tokens.Typography.calloutRelative)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                .disabled(syncing)
                .padding(.bottom, Tokens.Spacing.sm)
            }
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
            // A menu rather than a segmented control: eight readings do not
            // fit across a phone, and the two that squeeze in would be the two
            // somebody happened to put first.
            Picker(L10n.string("measurement.series"), selection: $series) {
                ForEach(ChartSeries.allCases) { option in
                    Text(L10n.string(option.titleKey)).tag(option)
                }
            }
            .pickerStyle(.menu)
            .frame(minHeight: Tokens.minimumTouchTarget)
            .accessibilityLabel(L10n.string("measurement.series"))
            .onChange(of: series) { _, chosen in
                Task { await loadSeries(chosen) }
            }

            if series.isBodyChart {
                curve(for: chart)
                    .frame(height: 240)
            } else {
                otherCurve
                    .frame(height: 240)
            }

            if series == .bmi, let latest = chart.bmi.last {
                BmiCategoryBadge(category: latest.category, value: latest.bmi)
            }

            if series.isBodyChart {
                LatestReadingSummary(chart: chart, series: series)
            }

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

    /**
     * The readings the body chart does not carry.
     *
     * Blood pressure draws two lines — systolic and diastolic — because one of
     * them alone is not a blood pressure.
     */
    @ViewBuilder
    private var otherCurve: some View {
        if otherSeries.isEmpty {
            MessageState(icon: "chart.xyaxis.line", text: L10n.string("measurement.emptySeries"))
        } else {
            Chart {
                ForEach(otherSeries) { point in
                    LineMark(
                        x: .value(L10n.string("measurement.date"), point.measuredAt),
                        y: .value(L10n.string(series.titleKey), point.value)
                    )
                    .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))

                    if let secondary = point.secondaryValue {
                        LineMark(
                            x: .value(L10n.string("measurement.date"), point.measuredAt),
                            y: .value(L10n.string("measurement.diastolic"), secondary),
                            series: .value("", "diastolic")
                        )
                        .foregroundStyle(Tokens.Palette.info.resolve(for: scheme))
                    }
                }
            }
            .chartYAxis { AxisMarks(position: .leading) }
            .accessibilityLabel(L10n.string(series.titleKey))
        }
    }

    private func loadSeries(_ chosen: ChartSeries) async {
        guard let type = chosen.measurementType, !chosen.isBodyChart else {
            otherSeries = []
            return
        }

        otherSeries = await model.series(type)
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
