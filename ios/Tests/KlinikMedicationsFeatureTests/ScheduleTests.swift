import XCTest
@testable import KlinikMedicationsFeature

/**
 * The translation from what a clinician says to what the server stores.
 *
 * Worth testing on its own because getting it wrong is quiet: an off-by-one in
 * `COUNT` does not fail anywhere, it just ends somebody's antibiotics a day
 * early, and nobody finds out until the infection comes back.
 */
final class ScheduleTests: XCTestCase {
    func testCountIsDosesNotDays() {
        // Twice a day for eight days is sixteen doses, not eight.
        XCTAssertEqual(
            Schedule(timesPerDay: 2, days: 8).rule,
            "FREQ=DAILY;COUNT=16;BYHOUR=9,21"
        )
    }

    func testOnceADayUsesOneHour() {
        XCTAssertEqual(
            Schedule(timesPerDay: 1, days: 5).rule,
            "FREQ=DAILY;COUNT=5;BYHOUR=9"
        )
    }

    /// Four times a day still stays inside waking hours: nobody is woken at
    /// 02:00 for a tablet, because a course like that stops being taken.
    func testFourTimesADayStaysWithinWakingHours() {
        let schedule = Schedule(timesPerDay: 4, days: 3)

        XCTAssertEqual(schedule.hours, [8, 12, 16, 20])
        XCTAssertEqual(schedule.totalDoses, 12)
        XCTAssertTrue(schedule.hours.allSatisfy { $0 >= 7 && $0 <= 22 })
    }

    /// The start time anchors the whole course, so it has to be the first hour.
    func testStartTimeIsTheFirstDose() {
        XCTAssertEqual(Schedule(timesPerDay: 3, days: 1).startTime, "08:00")
        XCTAssertEqual(Schedule(timesPerDay: 1, days: 1).startTime, "09:00")
    }

    /**
     * Nonsense is clamped rather than sent.
     *
     * A stepper cannot produce zero days today, but a future caller could, and
     * `COUNT=0` is a prescription the server would accept and the patient would
     * never be reminded of.
     */
    func testOutOfRangeInputIsClamped() {
        XCTAssertEqual(Schedule(timesPerDay: 0, days: 0).totalDoses, 1)
        XCTAssertEqual(Schedule(timesPerDay: 99, days: 9_999).timesPerDay, 4)
        XCTAssertEqual(Schedule(timesPerDay: 99, days: 9_999).days, 365)
    }
}
