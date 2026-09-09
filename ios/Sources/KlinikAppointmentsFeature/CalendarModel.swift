import Foundation
import KlinikAPI
import KlinikCore

public enum CalendarPhase: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

public struct CalendarState: Sendable, Equatable {
    public var phase: CalendarPhase = .loading
    /// The month on screen, as its first instant.
    public var month: Date = Date()
    public var entries: [CalendarEntry] = []
    public var selected: Date?
    public var busyId: String?
    public var error: String?

    public init() {}
}

/**
 * The clinic's calendar across every patient the caller can see (spec M10).
 *
 * A month at a time, fetched whole. The alternative — one request per visible
 * day — would be thirty round trips to draw a grid, and the grid needs every
 * day's count before it can draw any of them.
 *
 * Days are grouped in the caller's own timezone rather than UTC. An
 * appointment at half past midnight in Istanbul belongs to that day on the
 * clinic's wall, and grouping it by its UTC date would move it to the one
 * before on the screen of the person who booked it.
 */
@MainActor
public final class CalendarModel {
    private let api: AppointmentsAPI
    private let calendar: Calendar

    private var state = CalendarState()

    public init(api: AppointmentsAPI, calendar: Calendar = .current) {
        self.api = api
        self.calendar = calendar
        state.month = CalendarModel.startOfMonth(Date(), calendar: calendar)
    }

    public func currentState() -> CalendarState { state }

    public func load() async {
        let range = CalendarModel.bounds(of: state.month, calendar: calendar)

        do {
            state.entries = try await api.calendar(from: range.start, to: range.end)
            state.phase = .loaded
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    public func show(monthOffsetBy months: Int) async {
        guard let moved = calendar.date(byAdding: .month, value: months, to: state.month) else {
            return
        }

        state.month = CalendarModel.startOfMonth(moved, calendar: calendar)
        // A selection from the old month would sit outside the grid.
        state.selected = nil
        state.phase = .loading

        await load()
    }

    public func select(_ day: Date?) {
        state.selected = day.map { calendar.startOfDay(for: $0) }
    }

    /// Appointments on one day, earliest first.
    public func entries(on day: Date) -> [CalendarEntry] {
        state.entries
            .filter { calendar.isDate($0.appointment.scheduledAt, inSameDayAs: day) }
            .sorted { $0.appointment.scheduledAt < $1.appointment.scheduledAt }
    }

    /// How many appointments each day of the month holds, for the grid's dots.
    public func counts() -> [Date: Int] {
        state.entries.reduce(into: [:]) { counts, entry in
            let day = calendar.startOfDay(for: entry.appointment.scheduledAt)
            counts[day, default: 0] += 1
        }
    }

    /// Whether any appointment that day is still waiting on the clinic.
    public func hasRequests(on day: Date) -> Bool {
        entries(on: day).contains { $0.appointment.status == .requested }
    }

    public func confirm(_ appointmentId: String) async {
        await write(appointmentId) { try await self.api.confirm(appointmentId) }
    }

    public func cancel(_ appointmentId: String, reason: String?) async {
        await write(appointmentId) { try await self.api.cancel(appointmentId, reason: reason) }
    }

    private func write(_ id: String, _ work: () async throws -> Appointment) async {
        state.busyId = id
        state.error = nil

        defer { state.busyId = nil }

        do {
            _ = try await work()

            // Re-read rather than patch the local copy. A calendar entry is the
            // appointment *and* whose it is, and rebuilding one here would mean
            // this client could compose a row the server never sent. The month
            // is one request, and the rows do not move under the reader: a
            // confirmed appointment keeps its place and changes its badge.
            await load()
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }
    }

    // MARK: - Grid arithmetic
    //
    // Pure functions of a date and a calendar, so they are nonisolated: the
    // view draws thirty-five cells and should not hop to the main actor for
    // each one, and the tests should not have to be async to check them.

    nonisolated static func startOfMonth(_ date: Date, calendar: Calendar) -> Date {
        calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? date
    }

    /// The whole month, inclusive of its last instant.
    nonisolated static func bounds(of month: Date, calendar: Calendar) -> (start: Date, end: Date) {
        let start = startOfMonth(month, calendar: calendar)
        let end = calendar.date(byAdding: DateComponents(month: 1, second: -1), to: start) ?? start

        return (start, end)
    }

    /**
     * The days a month's grid shows, including the neighbours that fill the
     * first and last rows.
     *
     * Built from the calendar's own `firstWeekday` rather than assuming Monday:
     * the same grid is read in Istanbul and by a patient's family abroad, and a
     * week starting on the wrong day is a week somebody misreads.
     */
    nonisolated static func gridDays(for month: Date, calendar: Calendar) -> [Date] {
        let start = startOfMonth(month, calendar: calendar)

        guard let range = calendar.range(of: .day, in: .month, for: start) else { return [] }

        let leading = (calendar.component(.weekday, from: start) - calendar.firstWeekday + 7) % 7

        let days = (0..<(leading + range.count)).compactMap { offset in
            calendar.date(byAdding: .day, value: offset - leading, to: start)
        }

        // Pad to whole weeks so the grid does not change height month to month.
        let remainder = days.count % 7
        guard remainder != 0, let last = days.last else { return days }

        let tail = (1...(7 - remainder)).compactMap {
            calendar.date(byAdding: .day, value: $0, to: last)
        }

        return days + tail
    }
}
