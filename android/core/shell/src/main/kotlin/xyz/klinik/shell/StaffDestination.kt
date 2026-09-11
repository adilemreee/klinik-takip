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

    /**
     * The interpretations waiting on a clinician's signature (spec M5).
     *
     * Clinic-wide, like the two queues above it: the server holds every AI
     * output until somebody signs it off, so a queue nobody can open is a
     * queue that only grows.
     */
    data object PendingReports : StaffDestination {
        override val patientId: String? = null
    }

    /** What patients have reported, across the clinic (spec M7). */
    data object ComplicationQueue : StaffDestination {
        override val patientId: String? = null
    }

    /** The clinic's numbers (spec M11). */
    data object Analytics : StaffDestination {
        override val patientId: String? = null
    }

    /** What has been billed and what has been paid (spec M11). */
    data object Finance : StaffDestination {
        override val patientId: String? = null
    }

    /** Taking data out of the clinic, and what was left out of it (spec M12). */
    data object Exports : StaffDestination {
        override val patientId: String? = null
    }

    /** Which model service the clinic uses, and on what terms (spec 3.4). */
    data object AiSettings : StaffDestination {
        override val patientId: String? = null
    }

    /** Who did what to whose record (spec M13). */
    data object Audit : StaffDestination {
        override val patientId: String? = null
    }

    /** What the assistant is allowed to answer from (spec M4). */
    data object Protocols : StaffDestination {
        override val patientId: String? = null
    }

    /** The account somebody signed in with — password, devices (spec T7.3). */
    data object Account : StaffDestination {
        override val patientId: String? = null
    }

    /** The staff member's own notification preferences. */
    data object NotificationSettings : StaffDestination {
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
    data class Travel(override val patientId: String) : StaffDestination
    data class Medications(override val patientId: String) : StaffDestination
    data class LabPanels(override val patientId: String) : StaffDestination
    data class Checklist(override val patientId: String) : StaffDestination
    data class Consents(override val patientId: String) : StaffDestination
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

    /** Flights, hotel, transfer — and whether a clinician cleared the trip. */
    TRAVEL,

    /** What the clinician prescribed, and what the patient says they take. */
    MEDICATIONS,

    /** Confirmed results, as the laboratory printed them (spec M16). */
    LAB_PANELS,

    /** What the clinic still needs before the operation (spec M17). */
    CHECKLIST,

    /** What this patient has agreed to, and what they withdrew. */
    CONSENTS,
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
    FileSection.TRAVEL -> StaffDestination.Travel(patientId)
    FileSection.MEDICATIONS -> StaffDestination.Medications(patientId)
    FileSection.LAB_PANELS -> StaffDestination.LabPanels(patientId)
    FileSection.CHECKLIST -> StaffDestination.Checklist(patientId)
    FileSection.CONSENTS -> StaffDestination.Consents(patientId)
}

/**
 * The three places the staff app opens onto, mirroring the iOS tab bar.
 *
 * Tabs rather than one stack with a menu, because each is a different job and
 * a clinician moves between them mid-task: reading a file, then the queue,
 * then back to the same file. Separate stacks are the point — a tab that
 * forgot where it was would make the trip back cost as much as the trip out.
 */
enum class StaffTab {
    /** The morning: who needs attention, and what came in overnight (spec M5). */
    AGENDA,
    PATIENTS,

    /** Its own tab, not a pushed screen: there is a clock running on it. */
    EMERGENCY,
}

/**
 * The clinic-wide screens behind the overflow menu, in menu order.
 *
 * A list rather than a `when` over every destination: these are the ones that
 * belong in a menu, and a patient's lab results do not. Naming them here means
 * a screen that exists and has no way in shows up as a screen missing from
 * this list, which is the failure that put eight patient screens out of reach.
 */
val staffMenuDestinations: List<StaffDestination> = listOf(
    StaffDestination.PendingReports,
    StaffDestination.ComplicationQueue,
    StaffDestination.Analytics,
    StaffDestination.Finance,
    StaffDestination.Exports,
    StaffDestination.AiSettings,
    StaffDestination.Protocols,
    StaffDestination.Audit,
    StaffDestination.Account,
    StaffDestination.NotificationSettings,
)
