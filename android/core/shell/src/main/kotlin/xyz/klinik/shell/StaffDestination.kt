package xyz.klinik.shell

/**
 * Where clinic staff can get to inside one patient's file.
 *
 * Here rather than in the app module for the reason this module exists at all:
 * the routing decision is tested on a laptop rather than on a device. The app
 * holds the Compose wiring; this holds what the wiring is allowed to say.
 *
 * Every destination except the list carries a patient id. Not a convenience —
 * each of these screens is somebody's clinical record, and making the id part
 * of the destination means a screen cannot be opened without saying whose file
 * it is. A section opened without one would ask the server for "my" records on
 * behalf of a doctor, which is nobody's file.
 *
 * Mirrors the iOS `StaffDestination`.
 */
sealed interface StaffDestination {
    /**
     * The file this destination belongs to.
     *
     * Declared on the interface and overridden by each case rather than
     * derived in a `when`: the compiler then refuses a new destination that
     * forgets to say whose record it is, which is the whole point of carrying
     * it. Null only for the list.
     */
    val patientId: String?

    /** The list itself, and the only destination with no patient. */
    data object Patients : StaffDestination {
        override val patientId: String? = null
    }

    /**
     * The calls nobody has answered yet (spec M8).
     *
     * Clinic-wide rather than one patient's, which is the point of a triage
     * queue: it is read to find out *whose* it is.
     */
    data object EmergencyQueue : StaffDestination {
        override val patientId: String? = null
    }

    data class File(override val patientId: String, val name: String) : StaffDestination
    data class Measurements(override val patientId: String) : StaffDestination
    data class Documents(override val patientId: String) : StaffDestination
    data class LabReview(override val patientId: String) : StaffDestination
    data class LabTrend(override val patientId: String) : StaffDestination
    data class Photos(override val patientId: String) : StaffDestination
    data class FollowUp(override val patientId: String) : StaffDestination
    data class Appointments(override val patientId: String) : StaffDestination
    data class Conversation(override val patientId: String) : StaffDestination
}

/**
 * The sections of one patient's file, in the order a clinician reads them.
 *
 * A closed set rather than free-form routing, so every reachable screen is
 * listed in one place and one nobody can reach fails to compile rather than
 * quietly existing.
 */
enum class FileSection {
    MEASUREMENTS,
    DOCUMENTS,
    LAB_REVIEW,
    LAB_TREND,
    PHOTOS,
    FOLLOW_UP,
    APPOINTMENTS,
    CONVERSATION,
}

fun destinationFor(section: FileSection, patientId: String): StaffDestination = when (section) {
    FileSection.MEASUREMENTS -> StaffDestination.Measurements(patientId)
    FileSection.DOCUMENTS -> StaffDestination.Documents(patientId)
    FileSection.LAB_REVIEW -> StaffDestination.LabReview(patientId)
    FileSection.LAB_TREND -> StaffDestination.LabTrend(patientId)
    FileSection.PHOTOS -> StaffDestination.Photos(patientId)
    FileSection.FOLLOW_UP -> StaffDestination.FollowUp(patientId)
    FileSection.APPOINTMENTS -> StaffDestination.Appointments(patientId)
    FileSection.CONVERSATION -> StaffDestination.Conversation(patientId)
}
