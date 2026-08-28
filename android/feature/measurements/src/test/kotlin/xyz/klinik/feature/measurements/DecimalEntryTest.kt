package xyz.klinik.feature.measurements

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Patients arrive from many countries and the clinic's own staff type in
 * Turkish, so both separators reach the same field.
 */
class DecimalEntryTest {
    @Test
    fun `accepts either separator`() {
        assertEquals(72.4, DecimalEntry.parse("72.4"))
        assertEquals(72.4, DecimalEntry.parse("72,4"))
    }

    @Test
    fun `accepts a whole number`() {
        assertEquals(72.0, DecimalEntry.parse("72"))
    }

    @Test
    fun `ignores surrounding space`() {
        assertEquals(72.4, DecimalEntry.parse("  72,4 "))
    }

    /**
     * The dangerous case: a value that parses to *something* is worse than one
     * that is refused, because a weight drives dosing.
     */
    @Test
    fun `refuses text that is not only a number`() {
        assertNull(DecimalEntry.parse("72kg"))
        assertNull(DecimalEntry.parse("72 4"))
        assertNull(DecimalEntry.parse("-72"))
    }

    @Test
    fun `refuses more than one separator`() {
        assertNull(DecimalEntry.parse("72.4.5"))
        assertNull(DecimalEntry.parse("1,234.5"))
    }

    @Test
    fun `refuses a trailing separator`() {
        // Mid-typing, not a number yet: the save button must stay disabled
        // rather than send 72.
        assertNull(DecimalEntry.parse("72,"))
    }

    @Test
    fun `refuses empty input`() {
        assertNull(DecimalEntry.parse(""))
        assertNull(DecimalEntry.parse("   "))
    }
}
