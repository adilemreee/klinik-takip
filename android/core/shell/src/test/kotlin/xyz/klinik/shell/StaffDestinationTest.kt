package xyz.klinik.shell

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull

/**
 * Where a clinician can get to, and whose record they are looking at.
 *
 * Until these existed the staff app was a search box: the list drew, and
 * tapping a name did nothing — `onSelect` was an empty lambda with a note
 * saying the file would arrive later. Every model underneath already took a
 * patient id and had never been given one.
 */
class StaffDestinationTest {
    @Test
    fun `every section carries the patient it was opened from`() {
        val patientId = "01927f4e-2000-7000-8000-000000000001"

        FileSection.entries.forEach { section ->
            assertEquals(
                patientId,
                destinationFor(section, patientId).patientId,
                "$section lost the patient id",
            )
        }
    }

    /** Each section is its own screen; none of them collide. */
    @Test
    fun `sections do not share a destination`() {
        val destinations = FileSection.entries.map { destinationFor(it, "p1") }

        assertEquals(
            destinations.size,
            destinations.toSet().size,
            "two sections resolve to the same screen",
        )
    }

    /**
     * A second patient's file is a second set of destinations.
     *
     * The screens key their models on the destination, so if two patients
     * produced equal ones, opening a file after another would show the first
     * patient's records under the second one's name.
     */
    @Test
    fun `two patients do not share destinations`() {
        FileSection.entries.forEach { section ->
            assertNotEquals(
                destinationFor(section, "a"),
                destinationFor(section, "b"),
                "$section is the same destination for two different patients",
            )
        }
    }

    /** The list carries no patient, which is what makes it the root. */
    @Test
    fun `the list is the only destination without a patient`() {
        assertNull(StaffDestination.Patients.patientId)
    }

    /** The name travels with the file so the bar can say whose it is before
     *  the record has loaded. */
    @Test
    fun `the file carries the name it was opened under`() {
        val file = StaffDestination.File("p1", "Ayşe Yılmaz")

        assertEquals("p1", file.patientId)
        assertEquals("Ayşe Yılmaz", file.name)
    }
}
