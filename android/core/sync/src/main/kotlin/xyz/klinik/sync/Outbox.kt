package xyz.klinik.sync

/** A change made locally that has not reached the server yet. */
data class OutboxEntry(
    val id: String,
    val entityType: String,
    val entityId: String,
    val operation: Operation = Operation.UPDATE,
    /** The request body, already encoded. */
    val payload: String,
    /**
     * The version the record had when the user started editing. Sent back so
     * the server can tell whether anyone changed it in the meantime.
     */
    val baseVersion: Int?,
    val createdAtMillis: Long,
    val attempts: Int = 0,
    val lastError: String? = null,
) {
    enum class Operation { CREATE, UPDATE }
}

/**
 * A change the server refused because someone else edited the record first.
 *
 * Kept rather than discarded: spec M15 says clinical data is never silently
 * overwritten, which also means the user's work is never silently thrown away.
 */
data class SyncConflict(
    val id: String,
    val entityType: String,
    val entityId: String,
    /** What the user wrote. */
    val localPayload: String,
    /** What the server has now, for the screen to show alongside it. */
    val serverRecord: String,
    val serverVersion: Int,
    val detectedAtMillis: Long,
)

/**
 * Where the queue lives between launches.
 *
 * A port so the sync logic is testable without a database, and so the
 * Room-backed implementation is a detail rather than a dependency.
 */
interface OutboxStore {
    suspend fun pending(): List<OutboxEntry>
    suspend fun append(entry: OutboxEntry)
    suspend fun remove(id: String)
    suspend fun update(entry: OutboxEntry)

    suspend fun conflicts(): List<SyncConflict>
    suspend fun recordConflict(conflict: SyncConflict)
    suspend fun clearConflict(id: String)
}

/** In-memory store for tests and previews. */
class InMemoryOutboxStore : OutboxStore {
    private val entries = mutableListOf<OutboxEntry>()
    private val storedConflicts = mutableListOf<SyncConflict>()

    // Oldest first: edits to one record must reach the server in the order they
    // were made, or a later correction can be undone by an earlier one.
    override suspend fun pending(): List<OutboxEntry> = entries.sortedBy { it.createdAtMillis }

    override suspend fun append(entry: OutboxEntry) {
        entries += entry
    }

    override suspend fun remove(id: String) {
        entries.removeAll { it.id == id }
    }

    override suspend fun update(entry: OutboxEntry) {
        val index = entries.indexOfFirst { it.id == entry.id }
        if (index >= 0) entries[index] = entry
    }

    override suspend fun conflicts(): List<SyncConflict> = storedConflicts.toList()

    override suspend fun recordConflict(conflict: SyncConflict) {
        storedConflicts += conflict
    }

    override suspend fun clearConflict(id: String) {
        storedConflicts.removeAll { it.id == id }
    }
}

/**
 * A file whose upload was started and has not finished.
 *
 * Uploading is resumable against the server — it reports how many bytes it
 * already has — but only while the app still knows which session belonged to
 * which file. Held in memory that mapping dies with the process, and a patient
 * who was uploading a 20 MB scan when Android reclaimed the app starts again
 * from nothing, on a connection that was already struggling.
 */
data class PendingUpload(
    /** The server's upload session. */
    val id: String,
    /** Where the file is on this device. */
    val filePath: String,
    val patientId: String? = null,
    val originalName: String,
    val totalBytes: Long,
    val startedAt: Long,
)

/** Where unfinished uploads are remembered between launches. */
interface UploadStore {
    suspend fun unfinished(): List<PendingUpload>
    suspend fun remember(upload: PendingUpload)
    suspend fun forget(id: String)
}

/** In-memory store for tests and previews. */
class InMemoryUploadStore : UploadStore {
    private val uploads = mutableListOf<PendingUpload>()

    override suspend fun unfinished(): List<PendingUpload> = uploads.sortedBy { it.startedAt }

    override suspend fun remember(upload: PendingUpload) {
        uploads.removeAll { it.id == upload.id }
        uploads.add(upload)
    }

    override suspend fun forget(id: String) {
        uploads.removeAll { it.id == id }
    }
}
