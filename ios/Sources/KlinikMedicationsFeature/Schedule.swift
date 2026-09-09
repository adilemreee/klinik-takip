import Foundation
import KlinikCore

/**
 * A dosing schedule, expressed the way a clinician says it.
 *
 * The server stores an RFC 5545 RRULE, which is the right thing to store and
 * the wrong thing to put in front of a doctor: nobody writes
 * `FREQ=DAILY;COUNT=16;BYHOUR=9,21` on a prescription pad. They say "twice a
 * day for eight days", and this turns one into the other.
 *
 * The hours are fixed per frequency rather than free: a clinic that wants a
 * dose at 03:40 can say so in the instructions, and offering twenty-four
 * checkboxes would make the common case slower to serve the rare one.
 */
public struct Schedule: Sendable, Equatable {
    public let timesPerDay: Int
    public let days: Int

    public init(timesPerDay: Int, days: Int) {
        self.timesPerDay = max(1, min(timesPerDay, 4))
        self.days = max(1, min(days, 365))
    }

    /// Spread across waking hours, not every six hours round the clock: waking
    /// somebody at 02:00 for an antibiotic is how a course stops being taken.
    public var hours: [Int] {
        switch timesPerDay {
        case 1: return [9]
        case 2: return [9, 21]
        case 3: return [8, 14, 20]
        default: return [8, 12, 16, 20]
        }
    }

    public var totalDoses: Int { timesPerDay * days }

    /// What the server parses. `COUNT` is the total number of doses, so a
    /// twice-daily course for eight days ends after sixteen and not before.
    public var rule: String {
        "FREQ=DAILY;COUNT=\(totalDoses);BYHOUR=\(hours.map(String.init).joined(separator: ","))"
    }

    /// `HH:mm` of the first dose, which the server uses as the wall-clock
    /// anchor for the whole course.
    public var startTime: String {
        String(format: "%02d:00", hours.first ?? 9)
    }

    /// The sentence under the form, so a clinician can check what they wrote
    /// before it becomes sixteen notifications on somebody's phone.
    public var summary: String {
        let times = hours.map { String(format: "%02d:00", $0) }.joined(separator: ", ")

        return String(
            format: L10n.string("prescribe.summary"),
            timesPerDay,
            days,
            totalDoses,
            times
        )
    }
}
