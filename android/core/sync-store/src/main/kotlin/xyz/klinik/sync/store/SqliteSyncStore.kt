package xyz.klinik.sync.store

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteDriver
import androidx.sqlite.execSQL
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import xyz.klinik.sync.OutboxEntry
import xyz.klinik.sync.OutboxStore
import xyz.klinik.sync.PendingUpload
import xyz.klinik.sync.SyncConflict
import xyz.klinik.sync.UploadStore

/**
 * The offline queue's home on disk (spec M15, T2.6).
 *
 * Everything the sync engine holds is work the user has already done: an edit
 * typed on a ward round with no signal, a conflict waiting for somebody to
 * decide, a half-finished upload. In memory all of it dies when Android
 * reclaims the app — which is exactly when the connection was bad enough for
 * the queue to be full in the first place.
 *
 * The driver is injected rather than chosen here. That is what lets the code
 * that ships be the code that is tested: the same statements run against the
 * bundled SQLite on a test runner and on the device, with only the driver
 * differing.
 */
class SqliteSyncStore(
    driver: SQLiteDriver,
    path: String,
) : AutoCloseable {
    private val connection: SQLiteConnection = driver.open(path)

    /**
     * One writer at a time.
     *
     * SQLite serialises writes itself and would return SQLITE_BUSY rather than
     * corrupt anything, but a busy error surfaces as a lost edit somewhere up
     * the stack. The queue is small and the contention is between a background
     * sync and a screen; a mutex is the honest cost.
     */
    private val lock = Mutex()

    init {
        migrate()
    }

    /**
     * Schema versions, applied in order and recorded.
     *
     * `user_version` rather than "create table if not exists", so adding a
     * column later is a migration somebody wrote instead of a table that
     * silently differs between a fresh install and an upgrade.
     */
    private fun migrate() {
        val current = connection.prepare("PRAGMA user_version").use { statement ->
            if (statement.step()) statement.getLong(0).toInt() else 0
        }

        if (current < 1) {
            connection.execSQL(
                """
                CREATE TABLE IF NOT EXISTS outbox (
                  id TEXT PRIMARY KEY NOT NULL,
                  entity_type TEXT NOT NULL,
                  entity_id TEXT NOT NULL,
                  operation TEXT NOT NULL,
                  payload TEXT NOT NULL,
                  base_version INTEGER,
                  created_at INTEGER NOT NULL,
                  attempts INTEGER NOT NULL DEFAULT 0,
                  last_error TEXT
                )
                """.trimIndent(),
            )
            // Sending is always "oldest first", so the order is an index rather
            // than a sort of the whole queue on every pass.
            connection.execSQL("CREATE INDEX IF NOT EXISTS outbox_created_at ON outbox (created_at)")

            connection.execSQL(
                """
                CREATE TABLE IF NOT EXISTS conflict (
                  id TEXT PRIMARY KEY NOT NULL,
                  entity_type TEXT NOT NULL,
                  entity_id TEXT NOT NULL,
                  local_payload TEXT NOT NULL,
                  server_record TEXT NOT NULL,
                  server_version INTEGER NOT NULL,
                  detected_at INTEGER NOT NULL
                )
                """.trimIndent(),
            )

            connection.execSQL(
                """
                CREATE TABLE IF NOT EXISTS upload (
                  id TEXT PRIMARY KEY NOT NULL,
                  file_path TEXT NOT NULL,
                  patient_id TEXT,
                  original_name TEXT NOT NULL,
                  total_bytes INTEGER NOT NULL,
                  started_at INTEGER NOT NULL
                )
                """.trimIndent(),
            )

            connection.execSQL("PRAGMA user_version = 1")
        }
    }

    override fun close() = connection.close()

    internal suspend fun <T> transact(work: (SQLiteConnection) -> T): T =
        lock.withLock { work(connection) }
}

/** The offline queue, on disk. */
class SqliteOutboxStore(private val store: SqliteSyncStore) : OutboxStore {
    override suspend fun pending(): List<OutboxEntry> = store.transact { connection ->
        // Oldest first: edits to one record must reach the server in the order
        // they were made, or a later correction is undone by an earlier one.
        connection.prepare(
            """
            SELECT id, entity_type, entity_id, operation, payload, base_version,
                   created_at, attempts, last_error
            FROM outbox ORDER BY created_at ASC, id ASC
            """.trimIndent(),
        ).use { statement ->
            buildList {
                while (statement.step()) {
                    val operation = runCatching {
                        OutboxEntry.Operation.valueOf(statement.getText(3))
                    }.getOrNull()

                    // An unreadable operation would otherwise become a silently
                    // dropped edit. Skipping it keeps the rest of the queue
                    // moving; the row stays for somebody to look at.
                    if (operation != null) {
                        add(
                            OutboxEntry(
                                id = statement.getText(0),
                                entityType = statement.getText(1),
                                entityId = statement.getText(2),
                                operation = operation,
                                payload = statement.getText(4),
                                baseVersion = if (statement.isNull(5)) null else statement.getLong(5).toInt(),
                                createdAtMillis = statement.getLong(6),
                                attempts = statement.getLong(7).toInt(),
                                lastError = if (statement.isNull(8)) null else statement.getText(8),
                            ),
                        )
                    }
                }
            }
        }
    }

    override suspend fun append(entry: OutboxEntry) {
        store.transact { connection ->
            // Replace rather than insert: a retry that re-queues the same edit
            // must not put two of it in the queue.
            connection.prepare(
                """
                INSERT OR REPLACE INTO outbox
                  (id, entity_type, entity_id, operation, payload, base_version,
                   created_at, attempts, last_error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
            ).use { statement ->
                statement.bindText(1, entry.id)
                statement.bindText(2, entry.entityType)
                statement.bindText(3, entry.entityId)
                statement.bindText(4, entry.operation.name)
                statement.bindText(5, entry.payload)
                entry.baseVersion?.let { statement.bindLong(6, it.toLong()) } ?: statement.bindNull(6)
                statement.bindLong(7, entry.createdAtMillis)
                statement.bindLong(8, entry.attempts.toLong())
                entry.lastError?.let { statement.bindText(9, it) } ?: statement.bindNull(9)
                statement.step()
            }
        }
    }

    override suspend fun remove(id: String) {
        store.transact { connection ->
            connection.prepare("DELETE FROM outbox WHERE id = ?").use { statement ->
                statement.bindText(1, id)
                statement.step()
            }
        }
    }

    override suspend fun update(entry: OutboxEntry) {
        store.transact { connection ->
            // Only a row that is still queued: updating the attempt count of
            // something already sent would resurrect it.
            connection.prepare(
                "UPDATE outbox SET attempts = ?, last_error = ?, payload = ?, base_version = ? WHERE id = ?",
            ).use { statement ->
                statement.bindLong(1, entry.attempts.toLong())
                entry.lastError?.let { statement.bindText(2, it) } ?: statement.bindNull(2)
                statement.bindText(3, entry.payload)
                entry.baseVersion?.let { statement.bindLong(4, it.toLong()) } ?: statement.bindNull(4)
                statement.bindText(5, entry.id)
                statement.step()
            }
        }
    }

    override suspend fun conflicts(): List<SyncConflict> = store.transact { connection ->
        connection.prepare(
            """
            SELECT id, entity_type, entity_id, local_payload, server_record,
                   server_version, detected_at
            FROM conflict ORDER BY detected_at ASC, id ASC
            """.trimIndent(),
        ).use { statement ->
            buildList {
                while (statement.step()) {
                    add(
                        SyncConflict(
                            id = statement.getText(0),
                            entityType = statement.getText(1),
                            entityId = statement.getText(2),
                            localPayload = statement.getText(3),
                            serverRecord = statement.getText(4),
                            serverVersion = statement.getLong(5).toInt(),
                            detectedAtMillis = statement.getLong(6),
                        ),
                    )
                }
            }
        }
    }

    override suspend fun recordConflict(conflict: SyncConflict) {
        store.transact { connection ->
            connection.prepare(
                """
                INSERT OR REPLACE INTO conflict
                  (id, entity_type, entity_id, local_payload, server_record,
                   server_version, detected_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
            ).use { statement ->
                statement.bindText(1, conflict.id)
                statement.bindText(2, conflict.entityType)
                statement.bindText(3, conflict.entityId)
                statement.bindText(4, conflict.localPayload)
                statement.bindText(5, conflict.serverRecord)
                statement.bindLong(6, conflict.serverVersion.toLong())
                statement.bindLong(7, conflict.detectedAtMillis)
                statement.step()
            }
        }
    }

    override suspend fun clearConflict(id: String) {
        store.transact { connection ->
            connection.prepare("DELETE FROM conflict WHERE id = ?").use { statement ->
                statement.bindText(1, id)
                statement.step()
            }
        }
    }
}

/** Unfinished uploads, on disk. */
class SqliteUploadStore(private val store: SqliteSyncStore) : UploadStore {
    override suspend fun unfinished(): List<PendingUpload> = store.transact { connection ->
        connection.prepare(
            """
            SELECT id, file_path, patient_id, original_name, total_bytes, started_at
            FROM upload ORDER BY started_at ASC, id ASC
            """.trimIndent(),
        ).use { statement ->
            buildList {
                while (statement.step()) {
                    add(
                        PendingUpload(
                            id = statement.getText(0),
                            filePath = statement.getText(1),
                            patientId = if (statement.isNull(2)) null else statement.getText(2),
                            originalName = statement.getText(3),
                            totalBytes = statement.getLong(4),
                            startedAt = statement.getLong(5),
                        ),
                    )
                }
            }
        }
    }

    override suspend fun remember(upload: PendingUpload) {
        store.transact { connection ->
            connection.prepare(
                """
                INSERT OR REPLACE INTO upload
                  (id, file_path, patient_id, original_name, total_bytes, started_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """.trimIndent(),
            ).use { statement ->
                statement.bindText(1, upload.id)
                statement.bindText(2, upload.filePath)
                upload.patientId?.let { statement.bindText(3, it) } ?: statement.bindNull(3)
                statement.bindText(4, upload.originalName)
                statement.bindLong(5, upload.totalBytes)
                statement.bindLong(6, upload.startedAt)
                statement.step()
            }
        }
    }

    override suspend fun forget(id: String) {
        store.transact { connection ->
            connection.prepare("DELETE FROM upload WHERE id = ?").use { statement ->
                statement.bindText(1, id)
                statement.step()
            }
        }
    }
}
