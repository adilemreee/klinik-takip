package xyz.klinik.feature.medications

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The sentence a clinician says, turned into the rule the server stores.
 *
 * Every number here becomes a notification on somebody's phone at a particular
 * hour, so the arithmetic is worth holding to: a course that ends a day early
 * is a course of antibiotics that ends a day early.
 */
class ScheduleTest {
    /** `COUNT` is doses, not days — the mistake that ends a course early. */
    @Test
    fun `count is the total number of doses`() {
        assertEquals(
            "FREQ=DAILY;COUNT=16;BYHOUR=9,21",
            Schedule(2, 8).rule,
        )
        assertEquals(16, Schedule(2, 8).totalDoses)
    }

    /**
     * Waking hours, not every six hours round the clock.
     *
     * A 02:00 alarm for an antibiotic is how a course stops being taken.
     */
    @Test
    fun `the hours stay inside the day`() {
        assertEquals(listOf(9), Schedule(1, 5).hours)
        assertEquals(listOf(9, 21), Schedule(2, 5).hours)
        assertEquals(listOf(8, 14, 20), Schedule(3, 5).hours)
        assertEquals(listOf(8, 12, 16, 20), Schedule(4, 5).hours)
    }

    /** The first dose anchors the wall clock for the whole course. */
    @Test
    fun `the start time is the first hour`() {
        assertEquals("09:00", Schedule(2, 8).startTime)
        assertEquals("08:00", Schedule(3, 8).startTime)
    }

    /**
     * Out-of-range input is clamped rather than sent.
     *
     * A slip of the finger on a stepper should not become a hundred doses a
     * day, and the server would refuse it anyway — after the clinician had
     * filled the form in.
     */
    @Test
    fun `impossible frequencies are clamped`() {
        assertEquals(4, Schedule(12, 5).timesPerDay)
        assertEquals(1, Schedule(0, 5).timesPerDay)
        assertEquals(365, Schedule(2, 4000).days)
        assertEquals(1, Schedule(2, 0).days)
    }

    @Test
    fun `the hours read as times`() {
        assertEquals("09:00, 21:00", Schedule(2, 8).displayHours)
    }
}
