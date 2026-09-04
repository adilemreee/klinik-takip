package xyz.klinik.network

/**
 * Whose records a request is about.
 *
 * A type rather than a nullable id, because the two paths differ on the server
 * and the reason is the permission: a patient holds `self.read`, not
 * `documents.read`. Handing a patient the staff path answers 403 — and it did,
 * for four of their own screens, until the `me/` routes existed.
 *
 * The type is what stops a screen being wired to the wrong one: getting it
 * wrong is a compile error here rather than a permission error a patient sees
 * when they tap a tile.
 */
sealed interface RecordSubject {
    data class Patient(val id: String) : RecordSubject
    data object Me : RecordSubject

    /** The path for this subject, e.g. `me/documents` or `patients/<id>/documents`. */
    fun base(suffix: String): String = when (this) {
        is Patient -> "patients/$id/$suffix"
        Me -> "me/$suffix"
    }
}
