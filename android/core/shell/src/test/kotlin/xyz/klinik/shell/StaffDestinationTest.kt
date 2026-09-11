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

    /** The list carries no patient, which is what makes it a root. */
    @Test
    fun `the list carries no patient`() {
        assertNull(StaffDestination.Patients.patientId)
    }

    /**
     * A clinic-wide screen has a way in.
     *
     * This is the check that was missing when eight patient screens were
     * implemented with nothing that could open them. A destination with no
     * patient is one of the three tab roots or it is in the overflow menu;
     * anything else is a screen that exists and cannot be reached, which looks
     * from the outside exactly like a screen that was never built.
     */
    @Test
    fun `every clinic-wide destination is reachable`() {
        val tabRoots = setOf(
            StaffDestination.Patients,
            StaffDestination.EmergencyQueue,
            // The agenda's root is the briefing, which is not a destination:
            // it is the tab itself.
        )

        val unreachable = StaffDestination::class.sealedSubclasses
            .mapNotNull { it.objectInstance }
            .filter { it.patientId == null }
            .filterNot { it in tabRoots || it in staffMenuDestinations }

        assertEquals(
            emptyList(),
            unreachable,
            "no tab and no menu entry opens these",
        )
    }

    /** A menu that lists the same screen twice is a menu nobody trusts. */
    @Test
    fun `the menu names each screen once`() {
        assertEquals(
            staffMenuDestinations.size,
            staffMenuDestinations.toSet().size,
            "a destination appears twice in the staff menu",
        )
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
