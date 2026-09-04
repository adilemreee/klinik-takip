package xyz.klinik.shell

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * That every home action is accounted for in the app's routing.
 *
 * The `:app` module needs an Android SDK, so this cannot import its `when`
 * directly. It reads the source instead — crude, but it catches the failure
 * that matters: a home tile added later with no branch, which compiles fine
 * (Kotlin's `when` over an enum is exhaustive, so it would actually *not*
 * compile — this guards the opposite case, a branch quietly left as `null`
 * without anybody recording why).
 */
class HomeActionCoverageTest {
    private val navigation: String by lazy {
        val file = generateSequence(File(".").absoluteFile) { it.parentFile }
            .map { File(it, "app/src/main/kotlin/xyz/klinik/app/PatientNavigation.kt") }
            .firstOrNull { it.isFile }
            ?: fail("PatientNavigation.kt not found from ${File(".").absolutePath}")

        file.readText()
    }

    @Test
    fun `every home action appears in the routing`() {
        for (action in listOf(
            "MESSAGES",
            "UPLOAD_DOCUMENT",
            "MEDICATIONS",
            "ADD_PHOTO",
            "EMERGENCY",
        )) {
            assertTrue(
                navigation.contains("HomeAction.$action ->"),
                "$action is on the home screen and has no branch in destinationFor",
            )
        }
    }

    @Test
    fun `the actions that lead nowhere say why`() {
        // A tile that does nothing is defensible; one that does nothing with no
        // recorded reason is how a gap becomes permanent.
        assertTrue(navigation.contains("EMERGENCY -> null"))
        assertTrue(navigation.contains("MEDICATIONS -> null"))
        assertTrue(
            navigation.contains("arms the two-step confirmation") &&
                navigation.contains("no Compose screen yet"),
            "both null branches should carry the reason they are null",
        )
    }
}
