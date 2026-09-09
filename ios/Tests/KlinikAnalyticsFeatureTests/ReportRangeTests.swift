import XCTest
@testable import KlinikAnalyticsFeature

/**
 * The date arithmetic behind the period picker.
 *
 * Every mistake here is invisible on screen: a range that runs one day long
 * still draws a chart, and quietly reports a month that has not finished as if
 * it had.
 */
final class ReportRangeTests: XCTestCase {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Istanbul")!

        return calendar
    }()

    private func moment(_ iso: String) -> Date {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd HH:mm"

        return formatter.date(from: iso)!
    }

    /// "This month" ends now, not at the end of the month: a report about what
    /// has happened must not include bookings that have not.
    func testThisMonthStopsAtNow() {
        let now = moment("2026-09-09 14:00")
        let bounds = ReportRange.thisMonth.bounds(now: now, calendar: calendar)

        XCTAssertEqual(calendar.component(.day, from: bounds.from), 1)
        XCTAssertEqual(calendar.component(.month, from: bounds.from), 9)
        XCTAssertEqual(bounds.to, now)
    }

    func testThisYearStartsInJanuary() {
        let now = moment("2026-09-09 14:00")
        let bounds = ReportRange.thisYear.bounds(now: now, calendar: calendar)

        XCTAssertEqual(calendar.component(.month, from: bounds.from), 1)
        XCTAssertEqual(calendar.component(.day, from: bounds.from), 1)
        XCTAssertEqual(calendar.component(.year, from: bounds.from), 2026)
    }

    /// Last year is a closed year — it must not run into this one, or January's
    /// figures appear in both reports.
    func testLastYearEndsBeforeThisOneBegins() {
        let now = moment("2026-09-09 14:00")
        let bounds = ReportRange.lastYear.bounds(now: now, calendar: calendar)

        XCTAssertEqual(calendar.component(.year, from: bounds.from), 2025)
        XCTAssertEqual(calendar.component(.month, from: bounds.from), 1)
        XCTAssertEqual(calendar.component(.year, from: bounds.to), 2025)
        XCTAssertEqual(calendar.component(.month, from: bounds.to), 12)
        XCTAssertEqual(calendar.component(.day, from: bounds.to), 31)
    }

    /// Three months back from a 31st lands on a real date rather than nothing.
    func testThreeMonthsBackFromALongMonth() {
        let now = moment("2026-05-31 09:00")
        let bounds = ReportRange.lastThreeMonths.bounds(now: now, calendar: calendar)

        XCTAssertEqual(calendar.component(.month, from: bounds.from), 2)
        XCTAssertLessThan(bounds.from, bounds.to)
    }

    /// Every range runs forwards.
    func testEveryRangeIsOrdered() {
        let now = moment("2026-09-09 14:00")

        for range in ReportRange.allCases {
            let bounds = range.bounds(now: now, calendar: calendar)
            XCTAssertLessThan(bounds.from, bounds.to, "\(range) ran backwards")
        }
    }
}
