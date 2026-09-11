package xyz.klinik.feature.medications

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
 *
 * Mirrors the iOS `Schedule`.
 */
class Schedule(timesPerDay: Int, days: Int) {
    /**
     * Clamped rather than refused.
     *
     * A slip on a stepper should not become a hundred doses a day, and the
     * server would reject it — after the clinician had filled the form in.
     */
    val timesPerDay: Int = timesPerDay.coerceIn(1, 4)
    val days: Int = days.coerceIn(1, 365)

    /**
     * Spread across waking hours, not every six hours round the clock: waking
     * somebody at 02:00 for an antibiotic is how a course stops being taken.
     */
    val hours: List<Int>
        get() = when (timesPerDay) {
            1 -> listOf(9)
            2 -> listOf(9, 21)
            3 -> listOf(8, 14, 20)
            else -> listOf(8, 12, 16, 20)
        }

    val totalDoses: Int get() = timesPerDay * days

    /**
     * What the server parses.
     *
     * `COUNT` is the total number of doses, so a twice-daily course for eight
     * days ends after sixteen and not before.
     */
    val rule: String
        get() = "FREQ=DAILY;COUNT=$totalDoses;BYHOUR=${hours.joinToString(",")}"

    /**
     * `HH:mm` of the first dose, which the server uses as the wall-clock
     * anchor for the whole course.
     */
    val startTime: String get() = "%02d:00".format(hours.first())

    /** The hours as a reader sees them, for the sentence under the form. */
    val displayHours: String get() = hours.joinToString(", ") { "%02d:00".format(it) }

    override fun equals(other: Any?): Boolean =
        other is Schedule && other.timesPerDay == timesPerDay && other.days == days

    override fun hashCode(): Int = timesPerDay * 31 + days

    override fun toString(): String = rule
}
