package xyz.klinik.shell

/** A point on the signing surface, in pad coordinates. */
data class SignaturePoint(val x: Float, val y: Float)

/**
 * What counts as a signature.
 *
 * Here rather than in the Compose module so the rule can be held to on a
 * laptop: a consent recorded with an empty pad is a consent form with a blank
 * where the proof should be, and the failure is invisible until somebody
 * disputes it.
 */
object Signature {
    /**
     * Whether anything has been drawn.
     *
     * A single tap is not a signature, so a stroke of one point does not
     * count — a finger brushing the screen while scrolling should not sign
     * anything.
     */
    fun isSigned(strokes: List<List<SignaturePoint>>): Boolean =
        strokes.any { it.size > 1 }

    /** The strokes worth drawing or encoding — the rest are taps. */
    fun drawable(strokes: List<List<SignaturePoint>>): List<List<SignaturePoint>> =
        strokes.filter { it.size > 1 }
}
