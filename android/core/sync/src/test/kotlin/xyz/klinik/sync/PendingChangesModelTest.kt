package xyz.klinik.sync

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

/**
 * What has not reached the clinic yet (spec M15).
 *
 * The queue's promise is that work is not lost, so the two things held to here
 * are that resolving a conflict keeps the patient's version when they ask for
 * it, and that nothing is thrown away without being asked.
 */
class PendingChangesModelTest {
    private fun entry(id: String, at: Long, attempts: Int = 0) = OutboxEntry(
        id = id,
        entityType = "measurements",
        entityId = "m-$id",
        payload = """{"value":120}""",
        baseVersion = 1,
        createdAtMillis = at,
        attempts = attempts,
    )

    private suspend fun model(vararg entries: OutboxEntry): Pair<PendingChangesModel, OutboxStore> {
        val store = InMemoryOutboxStore()
        entries.forEach { store.append(it) }

        return PendingChangesModel(store) to store
    }

    /** Oldest first: the thing that has been waiting longest is read first. */
    @Test
    fun `the queue is read oldest first`() = runTest {
        val (subject, _) = model(entry("b", at = 2), entry("a", at = 1))

        subject.load()

        assertEquals(listOf("a", "b"), subject.state.value.entries.map { it.id })
    }

    /**
     * Stuck and waiting are separated.
     *
     * One will go by itself and the other will not, and a screen drawing both
     * the same way leaves somebody waiting on a queue that has given up.
     */
    @Test
    fun `what is stuck is kept apart from what is waiting`() = runTest {
        val (subject, _) = model(entry("ok", at = 1), entry("stuck", at = 2, attempts = 5))

        subject.load()

        assertEquals(listOf("ok"), subject.state.value.waiting.map { it.id })
        assertEquals(listOf("stuck"), subject.state.value.stuck.map { it.id })
    }

    @Test
    fun `discarding removes it from the queue`() = runTest {
        val (subject, store) = model(entry("a", at = 1, attempts = 5))

        subject.load()
        subject.discard(subject.state.value.entries.single())

        assertTrue(store.pending().isEmpty())
        assertTrue(subject.state.value.isEmpty)
    }

    /**
     * Keeping the local version queues it again against what the server has
     * now — not against the stale version that caused the conflict, which
     * would collide a second time.
     */
    @Test
    fun `keeping mine re-queues it against the server's current version`() = runTest {
        val store = InMemoryOutboxStore()
        val conflict = SyncConflict(
            id = "c1",
            entityType = "measurements",
            entityId = "m1",
            localPayload = """{"value":140}""",
            serverRecord = """{"value":120}""",
            serverVersion = 7,
            detectedAtMillis = 10,
        )
        store.recordConflict(conflict)

        val subject = PendingChangesModel(store)

        subject.load()
        subject.keepMine(conflict)

        val queued = store.pending().single()

        assertEquals("""{"value":140}""", queued.payload)
        assertEquals(7, queued.baseVersion)
        assertTrue(store.conflicts().isEmpty())
    }

    /** Keeping the clinic's version drops the local one and queues nothing. */
    @Test
    fun `keeping the server's version queues nothing`() = runTest {
        val store = InMemoryOutboxStore()
        val conflict = SyncConflict(
            id = "c1",
            entityType = "measurements",
            entityId = "m1",
            localPayload = """{"value":140}""",
            serverRecord = """{"value":120}""",
            serverVersion = 7,
            detectedAtMillis = 10,
        )
        store.recordConflict(conflict)

        val subject = PendingChangesModel(store)

        subject.load()
        subject.keepServer(conflict)

        assertTrue(store.pending().isEmpty())
        assertTrue(store.conflicts().isEmpty())
    }

    /**
     * With no engine wired there is nothing to send, and the model says so by
     * doing nothing rather than reporting a sync that did not happen.
     */
    @Test
    fun `sending with no engine changes nothing`() = runTest {
        val (subject, store) = model(entry("a", at = 1))

        subject.load()
        subject.sendNow()

        assertEquals(1, store.pending().size)
        assertEquals(null, subject.state.value.lastSyncedAtMillis)
        assertTrue(!subject.state.value.sending)
    }
}
