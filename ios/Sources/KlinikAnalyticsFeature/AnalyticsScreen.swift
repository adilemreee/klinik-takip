import Charts
import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * The clinic's numbers (spec M11).
 *
 * Dense on purpose — the spec allows a clinician's panel to carry more than a
 * patient's, as long as the hierarchy is legible. It is kept legible by one
 * rule: every figure says how complete it is. A revenue total assembled from
 * three currencies where one had no exchange rate for its day is not a total,
 * and this screen says so beside the number rather than in a footnote.
 */
public struct AnalyticsScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: AnalyticsModel

    @State private var state = AnalyticsState()

    public init(model: AnalyticsModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.xl) {
                controls

                switch state.phase {
                case .loading:
                    VStack(spacing: Tokens.Spacing.lg) {
                        SkeletonCard(lines: 4)
                        SkeletonCard(lines: 5)
                        SkeletonCard(lines: 4)
                    }
                    .accessibilityElement()
                    .accessibilityLabel(L10n.string("common.loading"))

                case .notPermitted:
                    MessageState(
                        icon: "lock",
                        text: L10n.string("analytics.notPermitted")
                    )
                    .frame(minHeight: 280)

                case .failed(let message):
                    MessageState(
                        icon: Tokens.State.labCritical.iconName,
                        text: message,
                        retryTitle: L10n.string("common.retry")
                    ) {
                        await reload()
                    }

                case .loaded:
                    procedures
                    revenue
                    geography
                    channels
                    occupancy
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("analytics.title"))
        .refreshable { await reload() }
        .task { await reload() }
    }

    // MARK: - Controls

    private var controls: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            Picker(L10n.string("analytics.range"), selection: rangeBinding) {
                ForEach(ReportRange.allCases) { range in
                    Text(range.localizedName).tag(range)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityLabel(L10n.string("analytics.range"))

            Picker(L10n.string("finance.currency"), selection: currencyBinding) {
                ForEach(Currency.allCases, id: \.self) { currency in
                    Text("\(currency.symbol) \(currency.rawValue)").tag(currency)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityLabel(L10n.string("finance.currency"))
        }
    }

    private var rangeBinding: Binding<ReportRange> {
        Binding(
            get: { state.range },
            set: { range in
                Task {
                    await model.choose(range: range)
                    state = model.currentState()
                }
            }
        )
    }

    private var currencyBinding: Binding<Currency> {
        Binding(
            get: { state.currency },
            set: { currency in
                Task {
                    await model.choose(currency: currency)
                    state = model.currentState()
                }
            }
        )
    }

    // MARK: - Operations

    @ViewBuilder
    private var procedures: some View {
        if let report = state.procedures {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(
                    title: L10n.string("analytics.procedures"),
                    subtitle: String(format: L10n.string("analytics.totalOperations"), report.total)
                )

                if report.byMonth.isEmpty {
                    Card { emptyNote }
                } else {
                    Card {
                        Chart(report.byMonth) { month in
                            BarMark(
                                x: .value(L10n.string("analytics.month"), month.month),
                                y: .value(L10n.string("analytics.count"), month.count)
                            )
                            .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                        }
                        .chartYAxis { AxisMarks(position: .leading) }
                        .frame(height: 180)
                        .accessibilityLabel(L10n.string("analytics.procedures"))
                    }
                }

                if !report.byProcedure.isEmpty {
                    Card {
                        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                            ForEach(report.byProcedure) { row in
                                ShareRow(
                                    label: row.label,
                                    count: row.count,
                                    share: Proportion(row.share)
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Money

    @ViewBuilder
    private var revenue: some View {
        if let report = state.revenue {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(
                    title: L10n.string("analytics.revenue"),
                    subtitle: String(
                        format: L10n.string("analytics.recordCount"),
                        report.recordCount
                    )
                )

                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: Tokens.Spacing.md),
                        GridItem(.flexible(), spacing: Tokens.Spacing.md),
                    ],
                    spacing: Tokens.Spacing.md
                ) {
                    StatTile(
                        value: report.net.converted.text,
                        label: L10n.string("analytics.net"),
                        tone: .info,
                        symbol: "banknote"
                    )
                    StatTile(
                        value: report.margin.converted.text,
                        label: L10n.string("analytics.margin"),
                        tone: report.marginIsWhole ? .success : .warning,
                        symbol: "chart.line.uptrend.xyaxis"
                    )
                    StatTile(
                        value: report.cost.converted.text,
                        label: L10n.string("analytics.cost"),
                        symbol: "arrow.down.circle"
                    )
                    StatTile(
                        value: report.agencyCommission.converted.text,
                        label: L10n.string("analytics.commission"),
                        symbol: "person.2"
                    )
                }

                // Beside the numbers, never as a footnote: a partial total that
                // looks whole is the one failure this panel must not have.
                if !report.caveats.isEmpty {
                    Card(tone: .warning) {
                        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                            ForEach(report.caveats, id: \.self) { caveat in
                                Label(caveat, systemImage: "exclamationmark.circle")
                                    .font(Tokens.Typography.captionRelative)
                                    .foregroundStyle(Tokens.Palette.warning.resolve(for: scheme))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }

                if !report.byMonth.isEmpty {
                    Card {
                        Chart(report.byMonth) { month in
                            LineMark(
                                x: .value(L10n.string("analytics.month"), month.month),
                                y: .value(
                                    L10n.string("analytics.net"),
                                    (Amount(month.net).value as NSDecimalNumber).doubleValue
                                )
                            )
                            .foregroundStyle(Tokens.Palette.success.resolve(for: scheme))

                            PointMark(
                                x: .value(L10n.string("analytics.month"), month.month),
                                y: .value(
                                    L10n.string("analytics.net"),
                                    (Amount(month.net).value as NSDecimalNumber).doubleValue
                                )
                            )
                            .foregroundStyle(Tokens.Palette.success.resolve(for: scheme))
                        }
                        .chartYAxis { AxisMarks(position: .leading) }
                        .frame(height: 180)
                        .accessibilityLabel(L10n.string("analytics.revenue"))
                    }
                }

                if !report.averageByCurrency.isEmpty {
                    Card {
                        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                            Text(L10n.string("analytics.averagePerCurrency"))
                                .font(Tokens.Typography.captionRelative)
                                .foregroundStyle(
                                    Tokens.Palette.textSecondary.resolve(for: scheme)
                                )

                            ForEach(report.averageByCurrency) { average in
                                HStack {
                                    Text("\(average.currency.symbol) \(average.average)")
                                        .font(Tokens.Typography.subheadingRelative)
                                        .foregroundStyle(
                                            Tokens.Palette.textPrimary.resolve(for: scheme)
                                        )

                                    Spacer(minLength: Tokens.Spacing.sm)

                                    Badge(
                                        String(
                                            format: L10n.string("analytics.recordCount"),
                                            average.count
                                        )
                                    )
                                }
                                .accessibilityElement(children: .combine)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Where patients come from

    @ViewBuilder
    private var geography: some View {
        if let report = state.geography, !report.byCountry.isEmpty {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(
                    title: L10n.string("analytics.geography"),
                    subtitle: String(format: L10n.string("analytics.patientCount"), report.total)
                )

                Card {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                        ForEach(report.byCountry) { country in
                            ShareRow(
                                label: country.label,
                                count: country.count,
                                share: Proportion(country.share)
                            )
                        }

                        if report.cityUnknown > 0 {
                            Text(
                                String(
                                    format: L10n.string("analytics.cityUnknown"),
                                    report.cityUnknown
                                )
                            )
                            .font(Tokens.Typography.captionRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var channels: some View {
        if let report = state.channels, !report.channels.isEmpty {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(
                    title: L10n.string("analytics.channels"),
                    subtitle: report.conversionDefinition
                )

                Card {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                        ForEach(report.channels) { channel in
                            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                                HStack {
                                    Text(channel.label)
                                        .font(Tokens.Typography.subheadingRelative)
                                        .foregroundStyle(
                                            Tokens.Palette.textPrimary.resolve(for: scheme)
                                        )

                                    Spacer(minLength: Tokens.Spacing.sm)

                                    // A rate computed over four patients is
                                    // noise; the server says so and the screen
                                    // repeats its words rather than a number.
                                    Text(Proportion(channel.conversionRate).formatted())
                                        .font(Tokens.Typography.subheadingRelative)
                                        .foregroundStyle(
                                            Tokens.Palette.accent.resolve(for: scheme)
                                        )
                                }

                                Text(
                                    String(
                                        format: L10n.string("analytics.convertedOf"),
                                        channel.converted,
                                        channel.patients
                                    )
                                )
                                .font(Tokens.Typography.captionRelative)
                                .foregroundStyle(
                                    Tokens.Palette.textSecondary.resolve(for: scheme)
                                )

                                if let revenue = channel.revenue {
                                    Text(revenue.converted.text)
                                        .font(Tokens.Typography.calloutRelative)
                                        .foregroundStyle(
                                            Tokens.Palette.success.resolve(for: scheme)
                                        )
                                }
                            }
                            .accessibilityElement(children: .combine)
                        }

                        if report.revenueWithheld {
                            Text(L10n.string("analytics.revenueWithheld"))
                                .font(Tokens.Typography.captionRelative)
                                .foregroundStyle(
                                    Tokens.Palette.textSecondary.resolve(for: scheme)
                                )
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var occupancy: some View {
        if let report = state.occupancy {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(title: L10n.string("analytics.occupancy"))

                if let notice = report.notice {
                    Card(tone: .info) {
                        Text(notice)
                            .font(Tokens.Typography.bodyRelative)
                            .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    Card {
                        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                            ForEach(report.byMonth) { month in
                                ShareRow(
                                    label: month.month,
                                    count: month.appointments,
                                    share: month.occupancy
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    private var emptyNote: some View {
        Text(L10n.string("analytics.nothingInRange"))
            .font(Tokens.Typography.bodyRelative)
            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}

/**
 * A label, a count and a bar.
 *
 * The bar is drawn from the share the server computed, and the share is
 * rendered as words when the server withheld it — a bar with nothing behind it
 * is a claim, and a proportion over four patients is not one worth making.
 */
struct ShareRow: View {
    @Environment(\.colorScheme) private var scheme

    let label: String
    let count: Int
    let share: Proportion

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            HStack {
                Text(label)
                    .font(Tokens.Typography.calloutRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                Spacer(minLength: Tokens.Spacing.sm)

                Text("\(count)")
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                Text(share.formatted())
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                        .fill(Tokens.Palette.surface.resolve(for: scheme))

                    RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                        .fill(Tokens.Palette.accent.resolve(for: scheme))
                        .frame(width: proxy.size.width * (share.value ?? 0))
                }
            }
            .frame(height: 6)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label), \(count), \(share.formatted())")
    }
}
