package xyz.klinik.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

/**
 * The interaction check, as the clinician's screen sees it (spec M5, T6.2).
 *
 * The property that matters on this screen: an empty warning list next to
 * unrecognised drugs is not a clean bill of health, and reading it as one is how
 * software misleads somebody into thinking a combination is safe.
 */
class InteractionsApiTest {
    @Test
    fun `says when nothing was actually checked`() {
        val check = json.decodeFromString<InteractionCheck>(
            """
            {"warnings":[],"unrecognised":[
              {"id":"m1","drugName":"Bilinmeyen A"},{"id":"m2","drugName":"Bilinmeyen B"}],
             "comparedPairs":0}
            """.trimIndent(),
        )

        assertTrue(check.warnings.isEmpty())
        // The screen must not read this as "no interactions".
        assertFalse(check.checkedAnything)
        assertEquals(2, check.unrecognised.size)
    }

    @Test
    fun `tells apart nothing found from nothing checked`() {
        val checked = json.decodeFromString<InteractionCheck>(
            """{"warnings":[],"unrecognised":[],"comparedPairs":3}""",
        )

        assertTrue(checked.warnings.isEmpty())
        assertTrue(checked.checkedAnything)
    }

    @Test
    fun `reads a warning with the drugs as written`() {
        val check = json.decodeFromString<InteractionCheck>(
            """
            {"warnings":[{"severity":"MAJOR","note":"Kanama riski artar.",
              "ingredients":["warfarin","acetylsalicylic-acid"],
              "between":[{"id":"m1","drugName":"Coumadin 5mg"},
                         {"id":"m2","drugName":"Coraspin 100mg"}]}],
             "unrecognised":[],"comparedPairs":1}
            """.trimIndent(),
        )

        assertTrue(check.checkedAnything)
        assertTrue(check.hasSevere)
        assertEquals(
            listOf("Coumadin 5mg", "Coraspin 100mg"),
            check.warnings[0].between.map { it.drugName },
        )
    }

    /** Interrupting on a minor interaction teaches people to dismiss the dialog. */
    @Test
    fun `only the serious ones interrupt`() {
        assertTrue(InteractionSeverity.CONTRAINDICATED.isSevere)
        assertTrue(InteractionSeverity.MAJOR.isSevere)
        assertFalse(InteractionSeverity.MODERATE.isSevere)
        assertFalse(InteractionSeverity.MINOR.isSevere)

        val minorOnly = json.decodeFromString<InteractionCheck>(
            """
            {"warnings":[{"severity":"MINOR","note":"Emilim azalabilir.",
              "ingredients":["levothyroxine","omeprazole"],
              "between":[{"id":"m1","drugName":"Euthyrox"},{"id":"m2","drugName":"Omeprazol"}]}],
             "unrecognised":[],"comparedPairs":1}
            """.trimIndent(),
        )

        assertFalse(minorOnly.hasSevere)
    }

    @Test
    fun `has a string key for every severity`() {
        for (severity in InteractionSeverity.entries) {
            assertTrue(severity.stringKey.startsWith("interaction_severity_"))
        }
    }

    /** An older server does not send the field at all; that is not a crash. */
    @Test
    fun `tolerates a medication view without an interaction check`() {
        val view = json.decodeFromString<MedicationView>(
            """
            {"medication":{"id":"m1","patientId":"p1","drugName":"Parol","dose":"500 mg",
              "frequencyRule":"FREQ=DAILY;COUNT=3","startDate":"2026-03-02T00:00:00.000Z"},
             "schedule":"günde 1, 3 doz"}
            """.trimIndent(),
        )

        assertEquals(null, view.interactions)
    }
}
