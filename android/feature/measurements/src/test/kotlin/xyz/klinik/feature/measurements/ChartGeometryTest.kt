package xyz.klinik.feature.measurements

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ChartGeometryTest {
    @Test
    fun `spreads points evenly across the width`() {
        val plot = ChartGeometry.plot(listOf(1.0, 2.0, 3.0))

        assertEquals(listOf(0.0, 0.5, 1.0), plot.points.map { it.x })
    }

    /** Y runs downwards, so the largest value sits at the top of the canvas. */
    @Test
    fun `puts the highest value at the top`() {
        val plot = ChartGeometry.plot(listOf(60.0, 80.0))

        assertEquals(1.0, plot.points[0].y)
        assertEquals(0.0, plot.points[1].y)
    }

    /**
     * A goal the patient is far from is exactly when the line matters, so the
     * scale has to stretch to include it rather than clipping it away.
     */
    @Test
    fun `stretches the scale to include a goal outside the readings`() {
        val plot = ChartGeometry.plot(listOf(90.0, 95.0), goal = 70.0)

        assertEquals(1.0, plot.goalY)
        assertTrue(plot.points.all { it.y < 1.0 })
    }

    @Test
    fun `reports no goal line when none is set`() {
        assertNull(ChartGeometry.plot(listOf(70.0, 71.0)).goalY)
    }

    /** Weight that has not moved must not divide by zero or collapse onto an edge. */
    @Test
    fun `draws an unchanged series across the middle`() {
        val plot = ChartGeometry.plot(listOf(72.0, 72.0, 72.0))

        assertEquals(listOf(0.5, 0.5, 0.5), plot.points.map { it.y })
    }

    /** One reading is a point, not the start of a curve missing its tail. */
    @Test
    fun `centres a single reading`() {
        val plot = ChartGeometry.plot(listOf(72.0))

        assertEquals(1, plot.points.size)
        assertEquals(0.5, plot.points[0].x)
    }

    @Test
    fun `handles no readings at all`() {
        val plot = ChartGeometry.plot(emptyList())

        assertTrue(plot.points.isEmpty())
        assertNull(plot.goalY)
    }
}
