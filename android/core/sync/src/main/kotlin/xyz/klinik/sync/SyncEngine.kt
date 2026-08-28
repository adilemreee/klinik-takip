package xyz.klinik.sync

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What happened when one queued change was sent. */
sealed interface SendOutcome {
    data object Applied : SendOutcome

    /**
     * The server refused it because the record moved on. Carries what the
     * server has now, so the user can be shown both sides.
     */
    data class Conflict(val serverRecord: String, val serverVersion: Int) : SendOutcome

    /** Worth trying again later — no connection, or the server is struggling. */
    data class Retryable(val message: String) : SendOutcome

    /**
     * Will never succeed as written: a validation failure, or a permission the
     * user no longer has.
     */
    data class Rejected(val message: String) : SendOutcome
}

/** Sends one queued change. A port, so the engine is testable without a server. */
fun interface OutboxSender {
    suspend fun send(entry: OutboxEntry): SendOutcome
}

/** What the sync indicator shows (spec M15). */
sealed interface SyncStatus {
    data object UpToDate : SyncStatus
    data class Offline(val pending: Int) : SyncStatus
    data class Syncing(val remaining: Int) : SyncStatus

    /**
     * Something needs a person: a conflict to resolve, or a change the server
     * will not accept.
     */
    data class NeedsAttention(val conflicts: Int, val rejected: Int) : SyncStatus
}

data class SyncState(
    val status: SyncStatus = SyncStatus.UpToDate,
    val lastSyncedAtMillis: Long? = null,
)

/**
 * Drains the outbox.
 *
 * Two rules shape the whole thing, and both come from spec M15's insistence
 * that clinical data is never silently overwritten:
 *
 * - A refused change is kept, not discarded. The user's work is not thrown away
 *   because someone else saved first.
 * - When one change to a record conflicts, later changes to *that record* are
 *   held back. They were written against the same stale picture, and sending
 *   them would apply edits on top of a state the user never saw.
 */
class SyncEngine(
    private val store: OutboxStore,
    private val sender: OutboxSender,
    private val maxAttempts: Int = 5,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val _state = MutableStateFlow(SyncState())
    val state: StateFlow<SyncState> = _state.asStateFlow()

    /**
     * Records a local change. The caller has already applied it locally — the
     * UI reads from the local store, so the user sees their edit immediately
     * whether or not the network is there.
     */
    suspend fun enqueue(entry: OutboxEntry) {
        store.append(entry)
        refreshStatus()
    }

    suspend fun sync(): SyncState {
        val entries = store.pending()

        if (entries.isEmpty()) {
            refreshStatus()
            return _state.value
        }

        _state.value = _state.value.copy(status = SyncStatus.Syncing(entries.size))

        // Records whose queue is blocked: either a conflict was just found, or
        // a change is stuck. Later edits to them wait.
        val blocked = mutableSetOf<String>()

        for (entry in entries) {
            val key = "${entry.entityType}:${entry.entityId}"
            if (key in blocked) continue

            when (val outcome = sender.send(entry)) {
                is SendOutcome.Applied -> store.remove(entry.id)

                is SendOutcome.Conflict -> {
                    store.recordConflict(
                        SyncConflict(
                            id = entry.id,
                            entityType = entry.entityType,
                            entityId = entry.entityId,
                            localPayload = entry.payload,
                            serverRecord = outcome.serverRecord,
                            serverVersion = outcome.serverVersion,
                            detectedAtMillis = now(),
                        ),
                    )
                    store.remove(entry.id)
                    blocked += key
                }

                is SendOutcome.Retryable -> {
                    // No point walking the rest of the queue: the same condition
                    // will meet every one of them.
                    store.update(entry.copy(attempts = entry.attempts + 1, lastError = outcome.message))
                    refreshStatus()
                    return _state.value
                }

                is SendOutcome.Rejected -> {
                    // Held rather than dropped. A change the server will not
                    // accept is something the user must be told about, not
                    // something that disappears.
                    store.update(entry.copy(attempts = entry.attempts + 1, lastError = outcome.message))
                    blocked += key
                }
            }
        }

        _state.value = _state.value.copy(lastSyncedAtMillis = now())
        refreshStatus()
        return _state.value
    }

    /**
     * Called when the user has dealt with a conflict, either by keeping their
     * version or the server's.
     */
    suspend fun resolveConflict(id: String, replayAs: OutboxEntry? = null) {
        store.clearConflict(id)
        replayAs?.let { store.append(it) }
        refreshStatus()
    }

    suspend fun conflicts(): List<SyncConflict> = store.conflicts()

    private suspend fun refreshStatus() {
        val pending = store.pending()
        val conflicts = store.conflicts()
        val rejected = pending.count { it.attempts >= maxAttempts }

        _state.value = _state.value.copy(
            status = when {
                conflicts.isNotEmpty() || rejected > 0 ->
                    SyncStatus.NeedsAttention(conflicts.size, rejected)
                pending.isEmpty() -> SyncStatus.UpToDate
                // Pending work with nothing wrong means we simply have not
                // reached the server yet.
                else -> SyncStatus.Offline(pending.size)
            },
        )
    }
}
