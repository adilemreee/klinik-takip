package xyz.klinik.charts

/** A point in the chart's own coordinates: 0..1 across, 0..1 down. */
data class PlotPoint(val x: Double, val y: Double)

data class Plot(
    val points: List<PlotPoint>,
    /** The goal's height in the same coordinates, or null when none is set. */
    val goalY: Double?,
    /**
     * A shaded band — a lab reference interval — in the same coordinates.
     *
     * `topY` is the smaller number because y runs downwards.
     */
    val band: Band? = null,
)

data class Band(val topY: Double, val bottomY: Double)

/**
 * Turning readings into coordinates.
 *
 * Kept out of the drawing code, and out of the Compose module, because this is
 * the part that can be wrong in a way nobody notices: a curve drawn against the
 * wrong scale still looks like a curve. Here it can be tested.
 */
object ChartGeometry {
    fun plot(
        values: List<Double>,
        goal: Double? = null,
        reference: ClosedFloatingPointRange<Double>? = null,
    ): Plot {
        if (values.isEmpty()) return Plot(emptyList(), null)

        // The goal and the reference band are folded into the range so neither
        // is drawn off the canvas — a value far outside its band is exactly
        // when the band matters most.
        val candidates = values +
            listOfNotNull(goal) +
            listOfNotNull(reference?.start, reference?.endInclusive)
        val low = candidates.min()
        val high = candidates.max()

        // A flat series would divide by zero. Giving it a band puts the line
        // across the middle, which is what "no change" looks like.
        val span = high - low
        val flat = span < 1e-9

        fun y(value: Double): Double = if (flat) 0.5 else 1.0 - (value - low) / span

        val points = values.mapIndexed { index, value ->
            // A single reading sits in the middle rather than hard against the
            // left edge, where it reads as the start of a curve that is missing.
            val x = if (values.size == 1) 0.5 else index.toDouble() / (values.size - 1)
            PlotPoint(x, y(value))
        }

        return Plot(
            points,
            goal?.let { y(it) },
            reference?.let { Band(topY = y(it.endInclusive), bottomY = y(it.start)) },
        )
    }
}
