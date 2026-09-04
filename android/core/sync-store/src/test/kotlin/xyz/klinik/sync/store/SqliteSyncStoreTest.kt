package xyz.klinik.sync.store

import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import java.nio.file.Files
import kotlin.io.path.absolutePathString
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.sync.OutboxEntry
import xyz.klinik.sync.PendingUpload
import xyz.klinik.sync.SyncConflict

/**
 * The offline queue on disk (spec M15, T2.6).
 *
 * The first tests are the whole point of the file: everything the sync engine
 * holds is work the user has already done, and in memory all of it dies when
 * Android reclaims the app — which is exactly when the connection was bad
 * enough for the queue to be full in the first place.
 *
 * These run against real SQLite through the same driver the app ships. A store
 * tested against a fake of itself has tested nothing.
 */
class SqliteSyncStoreTest {
    private lateinit var directory: java.nio.file.Path
    private val open = mutableListOf<SqliteSyncStore>()

    private fun store(): SqliteSyncStore =
        SqliteSyncStore(BundledSQLiteDriver(), directory.resolve("sync.db").absolutePathString())
            .also(open::add)

    private fun entry(
        id: String,
        entityId: String = "p1",
        createdAt: Long = 1_800_000_000_000,
        attempts: Int = 0,
    ) = OutboxEntry(
        id = id,
        entityType = "patients",
        entityId = entityId,
        payload = """{"note":"ağrı var"}""",
        baseVersion = 3,
        createdAtMillis = createdAt,
        attempts = attempts,
    )

    @BeforeTest
    fun setUp() {
        directory = Files.createTempDirectory("klinik-sync")
    }

    @AfterTest
    fun tearDown() {
        open.forEach { runCatching { it.close() } }
        open.clear()
        directory.toFile().deleteRecursively()
    }

    // --- Surviving a restart ------------------------------------------------

    @Test
    fun `the queue is still there after the app is killed`() = runTest {
        val first = store()
        SqliteOutboxStore(first).append(entry("e1"))
        first.close()

        // A new store on the same file is what a relaunch looks like.
        val pending = SqliteOutboxStore(store()).pending()

        assertEquals(listOf("e1"), pending.map { it.id })
        assertEquals(3, pending[0].baseVersion)
        assertEquals("""{"note":"ağrı var"}""", pending[0].payload)
    }

    @Test
    fun `a conflict survives too, because somebody still has to decide`() = runTest {
        // Spec M15: the user's work is never silently thrown away, and losing
        // it to a restart is throwing it away.
        val first = store()
        SqliteOutboxStore(first).recordConflict(
            SyncConflict("c1", "patients", "p1", "mine", "theirs", 4, 1_800_000_000_000),
        )
        first.close()

        val conflicts = SqliteOutboxStore(store()).conflicts()

        assertEquals(listOf("c1"), conflicts.map { it.id })
        assertEquals(4, conflicts[0].serverVersion)
    }

    @Test
    fun `an unfinished upload survives`() = runTest {
        // Resuming needs the mapping from server session to local file. Held in
        // memory it dies with the process, and a patient uploading a 20 MB scan
        // starts again from nothing.
        val first = store()
        SqliteUploadStore(first).remember(
            PendingUpload("s1", "/data/scan.pdf", "p1", "tahlil.pdf", 20_000_000, 1_800_000_000_000),
        )
        first.close()

        val unfinished = SqliteUploadStore(store()).unfinished()

        assertEquals(listOf("s1"), unfinished.map { it.id })
        assertEquals("/data/scan.pdf", unfinished[0].filePath)
        assertEquals(20_000_000, unfinished[0].totalBytes)
    }

    // --- Ordering -----------------------------------------------------------

    @Test
    fun `sends the oldest edit first`() = runTest {
        // Edits to one record must reach the server in the order they were
        // made, or a later correction is undone by an earlier one.
        val outbox = SqliteOutboxStore(store())
        val base = 1_800_000_000_000

        outbox.append(entry("later", createdAt = base + 60_000))
        outbox.append(entry("earlier", createdAt = base))
        outbox.append(entry("latest", createdAt = base + 120_000))

        assertEquals(listOf("earlier", "later", "latest"), outbox.pending().map { it.id })
    }

    @Test
    fun `unfinished uploads come back oldest first`() = runTest {
        val uploads = SqliteUploadStore(store())

        uploads.remember(PendingUpload("b", "/b", null, "b.pdf", 1, 1_800_000_060_000))
        uploads.remember(PendingUpload("a", "/a", null, "a.pdf", 1, 1_800_000_000_000))

        assertEquals(listOf("a", "b"), uploads.unfinished().map { it.id })
    }

    // --- The queue as the engine uses it ------------------------------------

    @Test
    fun `records a failed attempt without losing the edit`() = runTest {
        val first = store()
        SqliteOutboxStore(first).append(entry("e1"))
        SqliteOutboxStore(first).update(entry("e1", attempts = 2).copy(lastError = "bağlantı yok"))
        first.close()

        val pending = SqliteOutboxStore(store()).pending()

        assertEquals(2, pending[0].attempts)
        assertEquals("bağlantı yok", pending[0].lastError)
    }

    @Test
    fun `removes an edit once it has landed`() = runTest {
        val outbox = SqliteOutboxStore(store())
        outbox.append(entry("e1"))
        outbox.append(entry("e2"))

        outbox.remove("e1")

        assertEquals(listOf("e2"), outbox.pending().map { it.id })
    }

    @Test
    fun `queueing the same edit twice does not queue it twice`() = runTest {
        // A retry that re-queues the same edit must not send it twice.
        val outbox = SqliteOutboxStore(store())
        outbox.append(entry("e1", entityId = "p1"))
        outbox.append(entry("e1", entityId = "p2"))

        val pending = outbox.pending()
        assertEquals(1, pending.size)
        assertEquals("p2", pending[0].entityId)
    }

    @Test
    fun `updating something already sent does not resurrect it`() = runTest {
        val outbox = SqliteOutboxStore(store())
        outbox.append(entry("e1"))
        outbox.remove("e1")

        outbox.update(entry("e1", attempts = 1))

        assertTrue(outbox.pending().isEmpty())
    }

    @Test
    fun `keeps a null base version as null rather than nought`() = runTest {
        // Nought is a real version; "we do not know" is not.
        val outbox = SqliteOutboxStore(store())
        outbox.append(entry("e1").copy(baseVersion = null))

        assertNull(outbox.pending()[0].baseVersion)
    }

    @Test
    fun `clearing a conflict leaves the others`() = runTest {
        val outbox = SqliteOutboxStore(store())

        for (id in listOf("c1", "c2")) {
            outbox.recordConflict(SyncConflict(id, "patients", "p1", "", "", 1, 1_800_000_000_000))
        }

        outbox.clearConflict("c1")

        assertEquals(listOf("c2"), outbox.conflicts().map { it.id })
    }

    @Test
    fun `forgetting an upload leaves the others`() = runTest {
        val uploads = SqliteUploadStore(store())

        uploads.remember(PendingUpload("s1", "/a", null, "a.pdf", 1, 1))
        uploads.remember(PendingUpload("s2", "/b", null, "b.pdf", 1, 2))

        uploads.forget("s1")

        assertEquals(listOf("s2"), uploads.unfinished().map { it.id })
    }

    // --- The file itself ----------------------------------------------------

    @Test
    fun `opening an existing file again does not wipe it`() = runTest {
        // The migration runs on every open; a bare CREATE TABLE that was not
        // guarded would quietly start the queue over on the second launch.
        val first = store()
        SqliteOutboxStore(first).append(entry("e1"))
        first.close()

        repeat(3) { store().close() }

        assertEquals(1, SqliteOutboxStore(store()).pending().size)
    }

    @Test
    fun `records the schema version, so a later change can be a migration`() = runTest {
        val opened = store()

        val version = opened.transact { connection ->
            connection.prepare("PRAGMA user_version").use { statement ->
                if (statement.step()) statement.getLong(0).toInt() else -1
            }
        }

        assertEquals(1, version)
    }
}
