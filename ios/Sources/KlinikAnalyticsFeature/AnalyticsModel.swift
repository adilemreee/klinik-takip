import Foundation
import KlinikAPI
import KlinikCore

/// The ranges a clinic actually asks for, plus a way to say something else.
public enum ReportRange: String, Sendable, Equatable, CaseIterable, Identifiable {
    case thisMonth
    case lastThreeMonths
    case thisYear
    case lastYear

    public var id: String { rawValue }
    public var localizedName: String { L10n.string("analytics.range.\(rawValue)") }

    /// Half-open at the end so "this month" does not include tomorrow's
    /// bookings in a report about what has happened.
    public func bounds(now: Date = Date(), calendar: Calendar = .current) -> (from: Date, to: Date) {
        switch self {
        case .thisMonth:
            let start = calendar.date(
                from: calendar.dateComponents([.year, .month], from: now)
            ) ?? now

            return (start, now)

        case .lastThreeMonths:
            let start = calendar.date(byAdding: .month, value: -3, to: now) ?? now

            return (calendar.startOfDay(for: start), now)

        case .thisYear:
            let start = calendar.date(from: calendar.dateComponents([.year], from: now)) ?? now

            return (start, now)

        case .lastYear:
            let thisYear = calendar.date(from: calendar.dateComponents([.year], from: now)) ?? now
            let start = calendar.date(byAdding: .year, value: -1, to: thisYear) ?? now
            let end = calendar.date(byAdding: DateComponents(second: -1), to: thisYear) ?? now

            return (start, end)
        }
    }
}

public enum AnalyticsPhase: Sendable, Equatable {
    case loading
    case loaded
    /// Not a failure: an account without `analytics.read` simply has no panel.
    case notPermitted
    case failed(String)
}

public struct AnalyticsState: Sendable, Equatable {
    public var phase: AnalyticsPhase = .loading
    public var range: ReportRange = .thisYear
    public var currency: Currency = .turkishLira

    public var procedures: ProcedureReport?
    public var geography: GeographyReport?
    public var revenue: RevenueReport?
    public var channels: ChannelReport?
    public var occupancy: OccupancyReport?

    public init() {}
}

/**
 * The clinic's numbers (spec M11).
 *
 * Five reports, fetched together because they are one screen and a panel that
 * fills in over five seconds is a panel somebody screenshots half-drawn.
 *
 * Each one is allowed to be missing on its own. The revenue and channel
 * reports need `finance.read`, which a doctor may not hold while still being
 * allowed to see how many operations they did — so a 403 on one section leaves
 * the rest of the panel alone rather than replacing it with an error.
 */
@MainActor
public final class AnalyticsModel {
    private let api: AnalyticsAPI
    private var state = AnalyticsState()

    public init(api: AnalyticsAPI) {
        self.api = api
    }

    public func currentState() -> AnalyticsState { state }

    public func choose(range: ReportRange) async {
        state.range = range
        await load()
    }

    public func choose(currency: Currency) async {
        state.currency = currency
        await load()
    }

    public func load(now: Date = Date()) async {
        let bounds = state.range.bounds(now: now)

        async let procedures = attempt {
            try await self.api.procedures(from: bounds.from, to: bounds.to)
        }
        async let geography = attempt {
            try await self.api.geography(from: bounds.from, to: bounds.to)
        }
        async let revenue = attempt {
            try await self.api.revenue(from: bounds.from, to: bounds.to, currency: self.state.currency)
        }
        async let channels = attempt {
            try await self.api.channels(from: bounds.from, to: bounds.to, currency: self.state.currency)
        }
        async let occupancy = attempt {
            try await self.api.occupancy(from: bounds.from, to: bounds.to)
        }

        let loaded = await (procedures, geography, revenue, channels, occupancy)

        state.procedures = loaded.0.value
        state.geography = loaded.1.value
        state.revenue = loaded.2.value
        state.channels = loaded.3.value
        state.occupancy = loaded.4.value

        let errors = [
            loaded.0.error, loaded.1.error, loaded.2.error, loaded.3.error, loaded.4.error,
        ].compactMap { $0 }

        // Nothing at all came back. That means this account cannot see the
        // panel only when the server said so: a clinic nobody can reach is not
        // a permission problem, and telling somebody it is sends them to ask
        // for access they already have.
        guard errors.count == 5 else {
            state.phase = .loaded
            return
        }

        switch ReadOutcome.of(errors) {
        case .refused: state.phase = .notPermitted
        case .failed(let message): state.phase = .failed(message)
        }
    }
}
