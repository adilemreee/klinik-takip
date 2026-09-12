package xyz.klinik.sync

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * What a queued change is called, in words a patient would use.
 *
 * The queue stores a table name and an encoded body, which is the right thing
 * to store and the wrong thing to put in front of somebody waiting on it.
 */
class PendingChangesTest {
    private fun entry(
        entityType: String,
        payload: String = "{}",
        attempts: Int = 0,
    ) = OutboxEntry(
        id = "e1",
        entityType = entityType,
        entityId = "x1",
        payload = payload,
        baseVersion = null,
        createdAtMillis = 0,
        attempts = attempts,
    )

    @Test
    fun `each queued kind has a sentence`() {
        assertEquals("sync.item.measurement", entry("measurements").descriptionKey())
        assertEquals("sync.item.message", entry("messages").descriptionKey())
        assertEquals("sync.item.complication", entry("complications").descriptionKey())
        assertEquals("sync.item.survey", entry("surveys").descriptionKey())
    }

    /**
     * Taken and skipped are different facts about somebody following their
     * treatment, and a queue showing both as "medication" hides the one a
     * clinician cares about.
     */
    @Test
    fun `a dose check-in says which way it went`() {
        assertEquals(
            "sync.item.doseTaken",
            entry("medication-doses", """{"action":"take"}""").descriptionKey(),
        )
        assertEquals(
            "sync.item.doseSkipped",
            entry("medication-doses", """{"action":"skip"}""").descriptionKey(),
        )
        assertEquals(
            "sync.item.doseSnoozed",
            entry("medication-doses", """{"action":"snooze","snoozeMinutes":30}""").descriptionKey(),
        )
    }

    /**
     * An entity nobody named still gets a key.
     *
     * The caller falls back to the entity type as the server spells it, which
     * is honest and visible — better than a blank row for a change the patient
     * is waiting on.
     */
    @Test
    fun `an unnamed entity still produces a key`() {
        assertEquals("sync.item.photos", entry("photos").descriptionKey())
    }

    /**
     * Stuck is not waiting.
     *
     * Nothing will move a stuck entry without a person, and drawing both the
     * same way leaves somebody waiting on a queue that has given up.
     */
    @Test
    fun `a change that ran out of attempts is stuck`() {
        assertFalse(entry("messages", attempts = 4).isStuck())
        assertTrue(entry("messages", attempts = 5).isStuck())
    }
}
