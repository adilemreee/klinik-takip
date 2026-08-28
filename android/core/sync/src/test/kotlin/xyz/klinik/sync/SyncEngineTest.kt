package xyz.klinik.sync

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

/** Answers per entry id, and records what it was asked to send. */
private class ScriptedSender(
    private val outcomes: Map<String, SendOutcome> = emptyMap(),
    private val fallback: SendOutcome = SendOutcome.Applied,
) : OutboxSender {
    val sentIds = mutableListOf<String>()

    override suspend fun send(entry: OutboxEntry): SendOutcome {
        sentIds += entry.id
        return outcomes[entry.id] ?: fallback
    }
}

class SyncEngineTest {
    private var clock = 1_000_000L

    private fun entry(
        id: String,
        entity: String = "patients",
        record: String = "p1",
        version: Int? = 1,
        createdAt: Long = clock,
    ) = OutboxEntry(
        id = id,
        entityType = entity,
        entityId = record,
        payload = """{"city":"Berlin"}""",
        baseVersion = version,
        createdAtMillis = createdAt,
    )

    private fun engine(sender: OutboxSender, maxAttempts: Int = 5): Pair<SyncEngine, InMemoryOutboxStore> {
        val store = InMemoryOutboxStore()
        return SyncEngine(store, sender, maxAttempts) { clock } to store
    }

    /**
     * The user's edit is already visible locally; the queue is what still owes
     * the server.
     */
    @Test
    fun `enqueued work shows as pending`() = runTest {
        val (engine, _) = engine(ScriptedSender())

        engine.enqueue(entry("e1"))

        assertEquals(SyncStatus.Offline(1), engine.state.value.status)
    }

    @Test
    fun `a successful sync empties the queue`() = runTest {
        val (engine, store) = engine(ScriptedSender())
        engine.enqueue(entry("e1"))

        val state = engine.sync()

        assertEquals(SyncStatus.UpToDate, state.status)
        assertTrue(store.pending().isEmpty())
        assertNotNull(state.lastSyncedAtMillis)
    }

    /**
     * Edits to one record must reach the server in the order they were made, or
     * a later correction can be undone by an earlier one.
     */
    @Test
    fun `sends oldest first`() = runTest {
        val sender = ScriptedSender()
        val (engine, _) = engine(sender)

        engine.enqueue(entry("newer", createdAt = clock))
        engine.enqueue(entry("older", createdAt = clock - 60_000))

        engine.sync()

        assertEquals(listOf("older", "newer"), sender.sentIds)
    }

    // Conflicts

    /** Spec M15: refused work is kept, not discarded. */
    @Test
    fun `a conflict is recorded rather than dropped`() = runTest {
        val serverRecord = """{"city":"Hamburg","version":3}"""
        val sender = ScriptedSender(mapOf("e1" to SendOutcome.Conflict(serverRecord, 3)))
        val (engine, store) = engine(sender)
        engine.enqueue(entry("e1"))

        engine.sync()

        val conflicts = engine.conflicts()
        assertEquals(1, conflicts.size)
        assertEquals(3, conflicts.first().serverVersion)
        // Both sides are kept so the screen can show them together.
        assertEquals(serverRecord, conflicts.first().serverRecord)
        assertEquals("""{"city":"Berlin"}""", conflicts.first().localPayload)

        assertTrue(store.pending().isEmpty(), "a conflicted entry does not stay queued as-is")
    }

    @Test
    fun `a conflict asks for a person`() = runTest {
        val sender = ScriptedSender(mapOf("e1" to SendOutcome.Conflict("{}", 2)))
        val (engine, _) = engine(sender)
        engine.enqueue(entry("e1"))

        val state = engine.sync()

        assertEquals(SyncStatus.NeedsAttention(conflicts = 1, rejected = 0), state.status)
    }

    /**
     * The subtle rule.
     *
     * The later edits were written against the same stale picture. Sending them
     * would apply changes on top of a state the user never saw — the silent
     * overwrite spec M15 exists to prevent, one step removed.
     */
    @Test
    fun `a conflict holds back later edits to the same record`() = runTest {
        val sender = ScriptedSender(mapOf("e1" to SendOutcome.Conflict("{}", 2)))
        val (engine, _) = engine(sender)

        engine.enqueue(entry("e1", record = "p1", createdAt = clock - 60_000))
        engine.enqueue(entry("e2", record = "p1", createdAt = clock))

        engine.sync()

        assertEquals(listOf("e1"), sender.sentIds, "the second edit to the same record must wait")
    }

    /** Blocking is per record: one patient's conflict must not stall the rest. */
    @Test
    fun `a conflict does not hold back other records`() = runTest {
        val sender = ScriptedSender(mapOf("e1" to SendOutcome.Conflict("{}", 2)))
        val (engine, _) = engine(sender)

        engine.enqueue(entry("e1", record = "p1", createdAt = clock - 60_000))
        engine.enqueue(entry("e2", record = "p2", createdAt = clock))

        engine.sync()

        assertEquals(listOf("e1", "e2"), sender.sentIds)
    }

    @Test
    fun `resolving a conflict clears it`() = runTest {
        val sender = ScriptedSender(mapOf("e1" to SendOutcome.Conflict("{}", 2)))
        val (engine, _) = engine(sender)
        engine.enqueue(entry("e1"))
        engine.sync()

        engine.resolveConflict("e1")

        assertTrue(engine.conflicts().isEmpty())
        assertEquals(SyncStatus.UpToDate, engine.state.value.status)
    }

    /**
     * Keeping the local version means replaying it against the version the
     * server now has.
     */
    @Test
    fun `resolving can replay the edit against the new version`() = runTest {
        val sender = ScriptedSender(mapOf("e1" to SendOutcome.Conflict("{}", 3)))
        val (engine, store) = engine(sender)
        engine.enqueue(entry("e1"))
        engine.sync()

        engine.resolveConflict("e1", replayAs = entry("e1-replay", version = 3))

        val pending = store.pending()
        assertEquals(listOf("e1-replay"), pending.map { it.id })
        assertEquals(3, pending.first().baseVersion)
    }

    // Failures

    /** No point walking the rest of the queue: the same condition meets them all. */
    @Test
    fun `an offline failure stops the run and keeps everything`() = runTest {
        val sender = ScriptedSender(fallback = SendOutcome.Retryable("offline"))
        val (engine, store) = engine(sender)

        engine.enqueue(entry("e1", record = "p1", createdAt = clock - 60_000))
        engine.enqueue(entry("e2", record = "p2", createdAt = clock))

        val state = engine.sync()

        assertEquals(listOf("e1"), sender.sentIds, "the run stops at the first connection failure")
        assertEquals(2, store.pending().size, "nothing is lost")
        assertEquals(SyncStatus.Offline(2), state.status)
    }

    @Test
    fun `a retryable failure is tried again on the next run`() = runTest {
        val sender = ScriptedSender(fallback = SendOutcome.Retryable("offline"))
        val (engine, store) = engine(sender)
        engine.enqueue(entry("e1"))

        engine.sync()
        engine.sync()

        assertEquals(2, store.pending().first().attempts)
    }

    /**
     * A change the server will not accept is something the user must be told
     * about, not something that quietly disappears.
     */
    @Test
    fun `a rejected change is kept and surfaced`() = runTest {
        val sender = ScriptedSender(fallback = SendOutcome.Rejected("validation failed"))
        val (engine, store) = engine(sender, maxAttempts = 1)
        engine.enqueue(entry("e1"))

        val state = engine.sync()

        val pending = store.pending()
        assertEquals(1, pending.size)
        assertEquals("validation failed", pending.first().lastError)
        assertEquals(SyncStatus.NeedsAttention(conflicts = 0, rejected = 1), state.status)
    }

    /** One stuck change must not stall every other record's queue. */
    @Test
    fun `a rejected change does not block other records`() = runTest {
        val sender = ScriptedSender(mapOf("e1" to SendOutcome.Rejected("validation failed")))
        val (engine, _) = engine(sender)

        engine.enqueue(entry("e1", record = "p1", createdAt = clock - 60_000))
        engine.enqueue(entry("e2", record = "p2", createdAt = clock))

        engine.sync()

        assertEquals(listOf("e1", "e2"), sender.sentIds)
    }

    @Test
    fun `an empty queue reports up to date`() = runTest {
        val (engine, _) = engine(ScriptedSender())

        assertEquals(SyncStatus.UpToDate, engine.sync().status)
    }

    /**
     * Whatever happens, queued work is either sent, held for retry, or shown to
     * the user — never dropped on the floor.
     */
    @Test
    fun `nothing is ever silently lost`() = runTest {
        val sender = ScriptedSender(
            mapOf(
                "ok" to SendOutcome.Applied,
                "conflict" to SendOutcome.Conflict("{}", 2),
                "rejected" to SendOutcome.Rejected("no"),
            ),
        )
        val (engine, store) = engine(sender, maxAttempts = 1)

        engine.enqueue(entry("ok", record = "a", createdAt = clock - 30_000))
        engine.enqueue(entry("conflict", record = "b", createdAt = clock - 20_000))
        engine.enqueue(entry("rejected", record = "c", createdAt = clock - 10_000))

        engine.sync()

        val pending = store.pending()
        val conflicts = engine.conflicts()

        // Applied: gone. Conflicted: in the conflict list. Rejected: still
        // queued with its reason. Three in, three accounted for.
        assertEquals(2, pending.size + conflicts.size)
        assertEquals(listOf("conflict"), conflicts.map { it.id })
        assertEquals(listOf("rejected"), pending.map { it.id })
    }
}
