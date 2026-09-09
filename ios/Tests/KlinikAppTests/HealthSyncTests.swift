import XCTest
@testable import KlinikApp

/**
 * The one rule that decides what a watch's data does to a clinical chart.
 *
 * A heart rate sampled every few minutes for a fortnight is four thousand
 * points. The chart exists to show a recovery, and a recovery is not visible
 * through four thousand points — so one a day, and the latest, because the
 * evening's weight is the one after a day of walking.
 */
final class HealthSyncTests: XCTestCase {
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

    private func reading(_ iso: String, _ value: Double) -> HealthReading {
        HealthReading(type: .weight, value: value, measuredAt: moment(iso))
    }

    func testOneReadingPerDayAndItIsTheLatest() {
        let kept = HealthSync.latestPerDay(
            [
                reading("2026-09-08 07:00", 80),
                reading("2026-09-08 21:00", 79.4),
                reading("2026-09-09 07:30", 79.1),
            ],
            calendar: calendar
        )

        XCTAssertEqual(kept.count, 2)
        XCTAssertEqual(kept.first?.value, 79.4)
        XCTAssertEqual(kept.last?.value, 79.1)
    }

    /// The result is oldest first, which is the order a chart plots in.
    func testTheResultIsChronological() {
        let kept = HealthSync.latestPerDay(
            [
                reading("2026-09-10 08:00", 78),
                reading("2026-09-08 08:00", 80),
                reading("2026-09-09 08:00", 79),
            ],
            calendar: calendar
        )

        XCTAssertEqual(kept.map(\.value), [80, 79, 78])
    }

    /// The rule does not depend on the query's sort order.
    func testTheLatestWinsWhicheverOrderTheyArriveIn() {
        let ascending = HealthSync.latestPerDay(
            [reading("2026-09-08 07:00", 80), reading("2026-09-08 21:00", 79.4)],
            calendar: calendar
        )
        let descending = HealthSync.latestPerDay(
            [reading("2026-09-08 21:00", 79.4), reading("2026-09-08 07:00", 80)],
            calendar: calendar
        )

        XCTAssertEqual(ascending, descending)
        XCTAssertEqual(ascending.first?.value, 79.4)
    }

    /// A day boundary is the reader's midnight, not UTC's: a weight taken at
    /// half past midnight in Istanbul belongs to that day, not the one before.
    func testDaysAreTheReadersOwn() {
        let kept = HealthSync.latestPerDay(
            [reading("2026-09-09 00:30", 79), reading("2026-09-08 23:30", 80)],
            calendar: calendar
        )

        XCTAssertEqual(kept.count, 2)
    }

    func testNothingInNothingOut() {
        XCTAssertTrue(HealthSync.latestPerDay([], calendar: calendar).isEmpty)
    }
}
