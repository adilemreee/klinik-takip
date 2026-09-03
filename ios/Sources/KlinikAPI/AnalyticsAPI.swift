import Foundation
import KlinikCore

/**
 * The clinic dashboard (spec M11, T6.4).
 *
 * The types here exist mostly to stop one mistake: rendering "not enough to
 * say" as a number. A share, a conversion rate and an occupancy rate are all
 * optional, and every one of them is nil for a reason the reader has to be
 * told — too few cases, or no working hours configured. Printing 0% instead
 * would be a confident claim the data does not support.
 */

/// A proportion that may not exist yet.
public struct Proportion: Sendable, Equatable {
    public let value: Double?

    public init(_ value: Double?) {
        self.value = value
    }

    public var isKnown: Bool { value != nil }

    /**
     * The percentage, or the placeholder — never "0%".
     *
     * `reason` says why there is no number, because "—" on its own invites the
     * reader to assume the worst interpretation.
     */
    public func formatted(reason: String = L10n.string("analytics.tooFew")) -> String {
        guard let value else { return reason }

        return "\(Int((value * 100).rounded()))%"
    }
}

public struct NamedCount: Decodable, Sendable, Equatable, Identifiable {
    /// The clinic's own spelling.
    public let label: String
    public let count: Int
    /// Null when there are too few cases to state a proportion.
    public let share: Double?

    public var id: String { label }
    public var proportion: Proportion { Proportion(share) }
}

public struct MonthlyCount: Decodable, Sendable, Equatable, Identifiable {
    /// `2026-03`.
    public let month: String
    public let count: Int

    public var id: String { month }
}

public struct ProcedureReport: Decodable, Sendable, Equatable {
    public let from: Date
    public let to: Date
    public let total: Int
    /// Every month in range, empty ones included.
    public let byMonth: [MonthlyCount]
    public let byProcedure: [NamedCount]

    public var busiestMonth: MonthlyCount? { byMonth.max(by: { $0.count < $1.count }) }
}

public struct GeographyReport: Decodable, Sendable, Equatable {
    public let from: Date
    public let to: Date
    public let total: Int
    public let byCountry: [NamedCount]
    public let byCity: [NamedCount]
    /// Patients with no city recorded, so the shares add up.
    public let cityUnknown: Int
}

public struct ChannelRow: Decodable, Sendable, Equatable, Identifiable {
    public let label: String
    public let key: String
    public let patients: Int
    public let converted: Int
    public let conversionRate: Double?
    /// Absent when the viewer may not see money — see `ChannelReport.revenueWithheld`.
    public let revenue: Totals?

    public var id: String { key }
    public var conversion: Proportion { Proportion(conversionRate) }
}

public struct ChannelReport: Decodable, Sendable, Equatable {
    public let from: Date
    public let to: Date
    public let total: Int
    public let channels: [ChannelRow]
    /**
     * True when the viewer may not see money.
     *
     * The screen must say this. An empty revenue column otherwise reads as
     * "this channel earned nothing", which is a different and much worse claim
     * than "you are not allowed to see it".
     */
    public let revenueWithheld: Bool
    /// What "converted" means, so two readers cannot mean two things.
    public let conversionDefinition: String
    public let minimumForRate: Int

    public var revenueNotice: String? {
        revenueWithheld ? L10n.string("analytics.revenueWithheld") : nil
    }
}

public struct MonthlyNet: Decodable, Sendable, Equatable, Identifiable {
    public let month: String
    public let net: String
    /// False when this month had amounts with no exchange rate.
    public let converted: Bool

    public var id: String { month }
    public var amount: Amount { Amount(net) }
}

public struct CurrencyAverage: Decodable, Sendable, Equatable, Identifiable {
    public let currency: Currency
    public let average: String
    public let count: Int

    public var id: String { currency.rawValue }
    public var amount: Amount { Amount(average) }
}

public struct RevenueReport: Decodable, Sendable, Equatable {
    public let from: Date
    public let to: Date
    public let currency: Currency
    public let gross: Totals
    public let discount: Totals
    public let net: Totals
    public let cost: Totals
    public let agencyCommission: Totals
    /// Net less costs and commission.
    public let margin: Totals
    public let byMonth: [MonthlyNet]
    /// Exact, per currency. An average blended across currencies is a fiction.
    public let averageByCurrency: [CurrencyAverage]
    public let recordCount: Int
    public let cancelledExcluded: Int
    /// Non-zero means the margin is missing something.
    public let unreadableCostLines: Int

    /// Whether the margin can be shown without a caveat beside it.
    public var marginIsWhole: Bool { unreadableCostLines == 0 && margin.complete }

    public var caveats: [String] {
        var notes: [String] = []

        if unreadableCostLines > 0 { notes.append(L10n.string("analytics.costLinesUnread")) }
        if !net.complete { notes.append(L10n.string("finance.totals.incomplete")) }

        return notes
    }
}

public struct MonthlyOccupancy: Decodable, Sendable, Equatable, Identifiable {
    public let month: String
    public let bookedMinutes: Int
    public let availableMinutes: Int
    /// Null when no working hours are configured — not zero.
    public let rate: Double?
    public let appointments: Int

    public var id: String { month }
    public var occupancy: Proportion { Proportion(rate) }
}

public struct OccupancyReport: Decodable, Sendable, Equatable {
    public let from: Date
    public let to: Date
    public let byMonth: [MonthlyOccupancy]
    /// True when no availability window exists at all.
    public let capacityUnconfigured: Bool

    /// What to put on the screen instead of a chart nobody can read.
    public var notice: String? {
        capacityUnconfigured ? L10n.string("analytics.capacityUnconfigured") : nil
    }
}

public struct AnalyticsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func procedures(from: Date, to: Date) async throws -> ProcedureReport {
        try await client.send(
            Endpoint(method: .get, path: "analytics/procedures", query: Self.range(from, to)),
            as: ProcedureReport.self
        )
    }

    public func geography(from: Date, to: Date) async throws -> GeographyReport {
        try await client.send(
            Endpoint(method: .get, path: "analytics/geography", query: Self.range(from, to)),
            as: GeographyReport.self
        )
    }

    public func channels(
        from: Date,
        to: Date,
        currency: Currency = .turkishLira
    ) async throws -> ChannelReport {
        try await client.send(
            Endpoint(
                method: .get,
                path: "analytics/channels",
                query: Self.range(from, to).merging(["currency": currency.rawValue]) { _, new in new }
            ),
            as: ChannelReport.self
        )
    }

    public func revenue(
        from: Date,
        to: Date,
        currency: Currency = .turkishLira
    ) async throws -> RevenueReport {
        try await client.send(
            Endpoint(
                method: .get,
                path: "analytics/revenue",
                query: Self.range(from, to).merging(["currency": currency.rawValue]) { _, new in new }
            ),
            as: RevenueReport.self
        )
    }

    public func occupancy(from: Date, to: Date) async throws -> OccupancyReport {
        try await client.send(
            Endpoint(method: .get, path: "analytics/occupancy", query: Self.range(from, to)),
            as: OccupancyReport.self
        )
    }

    private static func range(_ from: Date, _ to: Date) -> [String: String] {
        let formatter = ISO8601DateFormatter()

        return ["from": formatter.string(from: from), "to": formatter.string(from: to)]
    }
}
