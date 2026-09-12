package xyz.klinik.sync

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Everything the pending-changes screen reads. */
data class PendingChanges(
    val entries: List<OutboxEntry> = emptyList(),
    val conflicts: List<SyncConflict> = emptyList(),
    val sending: Boolean = false,
    val lastSyncedAtMillis: Long? = null,
) {
    /** These will go on their own when there is a connection. */
    val waiting: List<OutboxEntry> get() = entries.filterNot { it.isStuck() }

    /** These will not. Nothing moves them without a person. */
    val stuck: List<OutboxEntry> get() = entries.filter { it.isStuck() }

    val isEmpty: Boolean get() = entries.isEmpty() && conflicts.isEmpty()
}

/**
 * What has not reached the clinic yet (spec M15).
 *
 * The queue exists so somebody recovering from surgery can record a
 * measurement in a hotel with no signal and not lose it. This reads it back so
 * the promise is visible: nobody should have to trust that something invisible
 * will happen.
 *
 * Discarding is offered only for the stuck ones. A change that is merely
 * waiting will go by itself, and a delete button beside it is an invitation to
 * throw away work that was about to succeed.
 */
class PendingChangesModel(
    private val store: OutboxStore,
    private val engine: SyncEngine? = null,
) {
    private val _state = MutableStateFlow(PendingChanges())
    val state: StateFlow<PendingChanges> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(
            entries = store.pending().sortedBy { it.createdAtMillis },
            conflicts = store.conflicts(),
        )
    }

    /**
     * Tries the queue now.
     *
     * Without an engine — which is the state of the app until something
     * enqueues — this reloads and nothing else, rather than pretending to send.
     */
    suspend fun sendNow() {
        _state.value = _state.value.copy(sending = true)

        val synced = engine?.sync()

        _state.value = _state.value.copy(
            sending = false,
            lastSyncedAtMillis = synced?.lastSyncedAtMillis ?: _state.value.lastSyncedAtMillis,
        )

        load()
    }

    /**
     * Throws one away, for good.
     *
     * The record never reaches the clinic and is gone from the phone; the
     * screen says so before this is called.
     */
    suspend fun discard(entry: OutboxEntry) {
        store.remove(entry.id)
        load()
    }

    /** Queues the local version again, against the version the server has now. */
    suspend fun keepMine(conflict: SyncConflict) {
        store.append(
            OutboxEntry(
                id = conflict.id,
                entityType = conflict.entityType,
                entityId = conflict.entityId,
                payload = conflict.localPayload,
                // The version the server holds now, so the retry is written
                // against what is actually there rather than the stale picture
                // that caused the conflict.
                baseVersion = conflict.serverVersion,
                createdAtMillis = conflict.detectedAtMillis,
            ),
        )
        store.clearConflict(conflict.id)
        load()
    }

    /** Drops the local version and leaves the clinic's record as it stands. */
    suspend fun keepServer(conflict: SyncConflict) {
        store.clearConflict(conflict.id)
        load()
    }
}
