package xyz.klinik.shell

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * What counts as a signature.
 *
 * A consent recorded with an empty pad is a form with a blank where the proof
 * should be, and nobody finds out until it is disputed.
 */
class SignatureTest {
    private fun stroke(vararg points: Pair<Float, Float>) =
        points.map { SignaturePoint(it.first, it.second) }

    @Test
    fun `an empty pad is not signed`() {
        assertFalse(Signature.isSigned(emptyList()))
    }

    /**
     * A finger brushing the screen while scrolling should not sign anything.
     */
    @Test
    fun `a single tap is not a signature`() {
        assertFalse(Signature.isSigned(listOf(stroke(10f to 10f))))
    }

    @Test
    fun `a drawn line is`() {
        assertTrue(Signature.isSigned(listOf(stroke(10f to 10f, 20f to 20f))))
    }

    /** One real stroke is enough, however many stray taps came with it. */
    @Test
    fun `taps alongside a stroke do not spoil it`() {
        val strokes = listOf(stroke(1f to 1f), stroke(10f to 10f, 20f to 20f))

        assertTrue(Signature.isSigned(strokes))
        assertEquals(1, Signature.drawable(strokes).size)
    }
}
