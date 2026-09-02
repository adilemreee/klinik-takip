import Charts
import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// Analyte trends, with the reference band behind them (spec M2).
public struct LabTrendScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: LabTrendModel

    @State private var state = LabTrendState()

    public init(model: LabTrendModel) {
        self.model = model
    }

    public var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .task { await refresh { await model.load() } }
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .loading:
            Spacer()
            ProgressView().accessibilityLabel(L10n.string("common.loading"))
            Spacer()

        case .empty:
            MessageState(icon: "chart.xyaxis.line", text: L10n.string("lab.trend.empty"))

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
            loaded
        }
    }

    private var loaded: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                // Above the charts, always. A critical value a doctor has to go
                // looking for is one they can miss.
                if !state.critical.isEmpty {
                    CriticalStrip(results: state.critical)
                }

                Picker("", selection: selection) {
                    ForEach(state.trends) { trend in
                        Text(trend.analyteName).tag(trend.id)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityLabel(L10n.string("lab.trend.analyte"))

                if let trend = state.selectedTrend {
                    TrendChart(trend: trend)
                        .frame(height: 240)

                    TrendSummary(trend: trend)
                }
            }
            .padding(Tokens.Spacing.lg)
        }
    }

    private var selection: Binding<String> {
        Binding(
            get: { state.selected ?? state.trends.first?.id ?? "" },
            set: { id in Task { await refresh { await model.select(id) } } }
        )
    }

    private func refresh(_ work: () async -> Void) async {
        await work()
        state = await model.currentState()
    }
}

struct TrendChart: View {
    @Environment(\.colorScheme) private var scheme

    let trend: AnalyteTrend

    var body: some View {
        Chart {
            // The band goes behind the line, and only when every point was
            // measured against it. A band drawn across points from different
            // ranges would put results on the wrong side of a line they were
            // never compared to.
            if let reference = trend.reference, let low = reference.low, let high = reference.high {
                RectangleMark(
                    yStart: .value(L10n.string("lab.trend.referenceLow"), low),
                    yEnd: .value(L10n.string("lab.trend.referenceHigh"), high)
                )
                .foregroundStyle(Tokens.Palette.successSurface.resolve(for: scheme))
            }

            ForEach(trend.points) { point in
                LineMark(
                    x: .value(L10n.string("measurement.date"), point.measuredAt),
                    y: .value(trend.analyteName, point.value)
                )
                .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))

                PointMark(
                    x: .value(L10n.string("measurement.date"), point.measuredAt),
                    y: .value(trend.analyteName, point.value)
                )
                // Critical points are red, and the summary underneath says so
                // in words — colour alone carries nothing for a reader who
                // cannot distinguish it (spec section 7).
                .foregroundStyle(colour(for: point.flag).resolve(for: scheme))
            }
        }
        .chartYScale(domain: .automatic(includesZero: false))
        .accessibilityLabel("\(trend.analyteName) (\(trend.unit))")
    }

    private func colour(for flag: LabFlag?) -> ThemedColor {
        switch flag {
        case .critical: return Tokens.Palette.critical
        case .low, .high: return Tokens.Palette.warning
        case .normal, nil: return Tokens.Palette.accent
        }
    }
}

/// The chart in words, for anyone who cannot see it — a plot is invisible to
/// VoiceOver however it is labelled.
struct TrendSummary: View {
    @Environment(\.colorScheme) private var scheme

    let trend: AnalyteTrend

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            if let latest = trend.points.last {
                HStack(spacing: Tokens.Spacing.sm) {
                    Text("\(L10n.string("measurement.latest")): \(format(latest.value)) \(trend.unit)")
                        .font(Tokens.Typography.bodyRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                    if let flag = latest.flag {
                        FlagBadge(flag: flag)
                    }
                }
            }

            if let reference = trend.reference {
                Text("\(L10n.string("lab.trend.reference")): \(bandText(reference))")
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            } else if trend.points.contains(where: { $0.refLow != nil || $0.refHigh != nil }) {
                // Said outright rather than silently omitting the band: a
                // missing band otherwise reads as "no reference range".
                Text(L10n.string("lab.trend.rangesDiffer"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.warning.resolve(for: scheme))
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func bandText(_ band: ReferenceBand) -> String {
        switch (band.low, band.high) {
        case let (low?, high?): return "\(format(low)) – \(format(high)) \(trend.unit)"
        case let (nil, high?): return "< \(format(high)) \(trend.unit)"
        case let (low?, nil): return "> \(format(low)) \(trend.unit)"
        default: return "—"
        }
    }

    private func format(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(format: "%.2f", value)
    }
}

/// Critical values, above the charts and never inside one.
struct CriticalStrip: View {
    @Environment(\.colorScheme) private var scheme

    let results: [LabResult]

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            Label(L10n.string("lab.trend.criticalTitle"), systemImage: Tokens.State.labCritical.iconName)
                .font(Tokens.Typography.subheadingRelative)
                .foregroundStyle(Tokens.Palette.critical.resolve(for: scheme))

            ForEach(results) { result in
                Text("\(result.analyteName): \(result.value) \(result.unit)")
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tokens.Palette.critical.resolve(for: scheme))
            }
        }
        .padding(Tokens.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tokens.Palette.criticalSurface.resolve(for: scheme))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .accessibilityElement(children: .combine)
    }
}
