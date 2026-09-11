package xyz.klinik.shell

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * That every patient screen can be opened.
 *
 * Twelve destinations were implemented and four could be reached: the home
 * screen's five tiles map to four of them, and the other eight sat in the
 * `when` with no way in at all. A screen nobody can open is the same defect as
 * a screen that does not exist, except it also costs a maintainer.
 *
 * Read from source for the reason [HomeActionCoverageTest] gives: `:app` needs
 * an Android SDK and this module deliberately does not.
 */
class PatientDestinationReachabilityTest {
    private fun source(path: String): String {
        val file = generateSequence(File(".").absoluteFile) { it.parentFile }
            .map { File(it, path) }
            .firstOrNull { it.isFile }
            ?: fail("$path not found from ${File(".").absolutePath}")

        return file.readText()
    }

    private val navigation: String by lazy {
        source("app/src/main/kotlin/xyz/klinik/app/PatientNavigation.kt")
    }

    private val strings: String by lazy {
        source("app/src/main/kotlin/xyz/klinik/app/FeatureStrings.kt")
    }

    /**
     * Every destination the sealed interface declares, read from the source.
     *
     * Derived rather than listed: a list a person has to remember to extend is
     * exactly the mechanism that let eight screens go unreachable in the first
     * place, and a thirteenth added tomorrow would slip past a hand-written
     * one the same way. `Home` is excluded — it is the screen the others are
     * reached from.
     */
    private val destinations: List<String> by lazy {
        val declared = Regex("""data object (\w+) : PatientDestination""")
            .findAll(navigation)
            .map { it.groupValues[1] }
            .filterNot { it == "Home" }
            .toList()

        assertTrue(declared.size > 8, "only ${declared.size} parsed; the declaration changed")

        declared
    }

    @Test
    fun `every destination is rendered`() {
        for (destination in destinations) {
            assertTrue(
                navigation.contains("PatientDestination.$destination ->"),
                "$destination is declared and has no branch that draws it",
            )
        }
    }

    /**
     * And every one of them is reachable — from a tile, or from the menu.
     *
     * The four the tiles carry are named in `destinationFor`; the rest have to
     * be in `patientMenuDestinations`, which is the only other way in.
     */
    @Test
    fun `every destination can be opened`() {
        val menu = navigation.substringAfter("val patientMenuDestinations")
            .substringBefore(")")

        for (destination in destinations) {
            val onATile = navigation.contains("-> PatientDestination.$destination\n")
            val inTheMenu = menu.contains("PatientDestination.$destination")

            assertTrue(
                onATile || inTheMenu,
                "$destination is drawn but nothing opens it",
            )
        }
    }

    /** And each one is named, rather than showing a raw key in the menu. */
    @Test
    fun `every destination has a name`() {
        for (destination in destinations) {
            assertTrue(
                strings.contains("PatientDestination.$destination ->"),
                "$destination has no entry in stringForDestination",
            )
        }
    }
}
