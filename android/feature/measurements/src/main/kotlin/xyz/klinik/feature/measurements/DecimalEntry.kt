package xyz.klinik.feature.measurements

/**
 * Reading a number the way a person typed it.
 *
 * A Turkish keyboard produces "72,4" and an English one "72.4", and both reach
 * this app — patients arrive from many countries and the clinic's own staff
 * type in Turkish. `"72,4".toDoubleOrNull()` is null, so a naive parse turns a
 * perfectly good weight into a blank field.
 *
 * Deliberately locale-independent: it accepts either separator rather than the
 * one the device is set to, because the device locale and the keyboard the
 * person is using are not the same thing.
 */
object DecimalEntry {
    fun parse(text: String): Double? {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return null

        // Anything that is not digits and a single separator is refused rather
        // than parsed into something plausible: a weight drives dosing.
        if (!trimmed.all { it.isDigit() || it == '.' || it == ',' }) return null
        if (trimmed.count { it == '.' || it == ',' } > 1) return null

        val normalised = trimmed.replace(',', '.')
        if (normalised.endsWith(".")) return null

        return normalised.toDoubleOrNull()
    }
}
