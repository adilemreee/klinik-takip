import XCTest
import KlinikAPI
@testable import KlinikAppointmentsFeature

/**
 * The grid arithmetic.
 *
 * Worth its own tests because every one of these bugs is silent: a month whose
 * first row starts on the wrong weekday still renders, still scrolls, and puts
 * every appointment on the wrong square.
 */
final class CalendarGridTests: XCTestCase {
    private func calendar(firstWeekday: Int, timeZone: String = "Europe/Istanbul") -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.firstWeekday = firstWeekday
        calendar.timeZone = TimeZone(identifier: timeZone)!

        return calendar
    }

    private func date(_ iso: String, in calendar: Calendar) -> Date {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"

        return formatter.date(from: iso)!
    }

    /// September 2026 begins on a Tuesday. With weeks starting on Monday the
    /// grid opens with one leading day from August.
    func testTheGridStartsOnTheReadersFirstWeekday() {
        let monday = calendar(firstWeekday: 2)
        let days = CalendarModel.gridDays(
            for: date("2026-09-01", in: monday),
            calendar: monday
        )

        XCTAssertEqual(monday.component(.weekday, from: days[0]), monday.firstWeekday)
        XCTAssertEqual(monday.component(.day, from: days[0]), 31)
        XCTAssertEqual(monday.component(.month, from: days[0]), 8)
    }

    /// The same month, read where the week starts on Sunday, opens two days
    /// earlier — which is the whole reason this is not hard-coded.
    func testTheGridFollowsASundayFirstCalendar() {
        let sunday = calendar(firstWeekday: 1)
        let days = CalendarModel.gridDays(
            for: date("2026-09-01", in: sunday),
            calendar: sunday
        )

        XCTAssertEqual(sunday.component(.weekday, from: days[0]), 1)
        XCTAssertEqual(sunday.component(.day, from: days[0]), 30)
    }

    /// Always whole weeks, so the grid does not change height month to month.
    func testTheGridIsAlwaysWholeWeeks() {
        let monday = calendar(firstWeekday: 2)

        for month in 1...12 {
            let start = date(String(format: "2026-%02d-01", month), in: monday)
            let days = CalendarModel.gridDays(for: start, calendar: monday)

            XCTAssertEqual(days.count % 7, 0, "month \(month) did not fill whole weeks")
            XCTAssertGreaterThanOrEqual(days.count, 28)
        }
    }

    /// The range asked of the server covers the month and stops inside it, so
    /// a neighbouring month's appointments are not drawn on the padding days.
    func testTheFetchedRangeIsExactlyTheMonth() {
        let monday = calendar(firstWeekday: 2)
        let bounds = CalendarModel.bounds(of: date("2026-02-01", in: monday), calendar: monday)

        XCTAssertEqual(monday.component(.day, from: bounds.start), 1)
        XCTAssertEqual(monday.component(.month, from: bounds.start), 2)
        // 2026 is not a leap year.
        XCTAssertEqual(monday.component(.day, from: bounds.end), 28)
        XCTAssertEqual(monday.component(.month, from: bounds.end), 2)
    }

    /// A leap February keeps its extra day.
    func testALeapFebruaryEndsOnTheTwentyNinth() {
        let monday = calendar(firstWeekday: 2)
        let bounds = CalendarModel.bounds(of: date("2028-02-01", in: monday), calendar: monday)

        XCTAssertEqual(monday.component(.day, from: bounds.end), 29)
    }
}
