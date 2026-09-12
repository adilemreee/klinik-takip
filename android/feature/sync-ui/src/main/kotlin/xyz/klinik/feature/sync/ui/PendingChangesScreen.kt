package xyz.klinik.feature.sync.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.sync.OutboxEntry
import xyz.klinik.sync.SyncConflict
import xyz.klinik.sync.descriptionKey
import xyz.klinik.sync.isStuck

/** Text the screen needs, resolved by the caller from string resources. */
data class PendingChangesStrings(
    val title: String,
    val empty: String,
    val emptyDetail: String,
    val upToDate: String,
    val sendNow: String,
    val sending: String,
    val waiting: String,
    val stuck: String,
    val stuckDetail: String,
    val discard: String,
    val discardTitle: String,
    val discardDetail: String,
    val cancel: String,
    val conflictTitle: String,
    val conflictDetail: String,
    val keepMine: String,
    val keepServer: String,
    val urgentWarning: String,
    val attempts: (Int) -> String,
    val lastError: (String) -> String,
    val lastSynced: (String) -> String,
    val pendingCount: (Int) -> String,
    val pendingOne: String,
    /** The entity type, in words, with the server's spelling as a fallback. */
    val describe: (OutboxEntry) -> String,
)

/** What the screen needs to know about the queue, without owning the engine. */
data class PendingChangesState(
    val entries: List<OutboxEntry> = emptyList(),
    val conflicts: List<SyncConflict> = emptyList(),
    val sending: Boolean = false,
    val lastSyncedAt: String? = null,
) {
    val waiting: List<OutboxEntry> get() = entries.filterNot { it.isStuck() }
    val stuck: List<OutboxEntry> get() = entries.filter { it.isStuck() }
    val isEmpty: Boolean get() = entries.isEmpty() && conflicts.isEmpty()
}

/**
 * What has not reached the clinic yet (spec M15).
 *
 * The queue exists so a patient recovering from surgery can record a
 * measurement in a hotel with no signal and not lose it. This screen is the
 * other half of that promise: it says what is still on the phone, in words
 * rather than table names, so nobody has to trust that something invisible
 * will happen.
 *
 * Three states, kept apart. Waiting will go on its own. Stuck will not —
 * nothing moves it without a person, and drawing it like the others leaves
 * somebody waiting on a queue that has given up. A conflict is neither: the
 * clinic changed the same record, and only a person can say which version is
 * right.
 *
 * The line about phoning the clinic in an emergency is always on screen. A
 * queue is not a way to reach anybody urgently, and somebody watching one
 * should be told so before they decide to wait.
 */
@Composable
fun PendingChangesScreen(
    state: PendingChangesState,
    strings: PendingChangesStrings,
    onSendNow: () -> Unit,
    onDiscard: (OutboxEntry) -> Unit,
    onKeepMine: (SyncConflict) -> Unit,
    onKeepServer: (SyncConflict) -> Unit,
    modifier: Modifier = Modifier,
) {
    var discarding by remember { mutableStateOf<OutboxEntry?>(null) }

    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        if (state.isEmpty) {
            Centred {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(strings.empty, color = klinikColor("textPrimary"))
                    Text(
                        strings.emptyDetail,
                        fontSize = Tokens.Typography.caption.size,
                        color = klinikColor("textSecondary"),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = Tokens.Spacing.sm),
                    )

                    state.lastSyncedAt?.let {
                        Text(
                            strings.lastSynced(it),
                            fontSize = Tokens.Typography.caption.size,
                            color = klinikColor("textSecondary"),
                            modifier = Modifier.padding(top = Tokens.Spacing.sm),
                        )
                    }
                }
            }

            return@Surface
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
        ) {
            Text(
                strings.title,
                fontSize = Tokens.Typography.heading.size,
                fontWeight = Tokens.Typography.heading.weight,
                color = klinikColor("textPrimary"),
                modifier = Modifier.semantics { heading() },
            )

            Text(
                if (state.entries.size == 1) {
                    strings.pendingOne
                } else {
                    strings.pendingCount(state.entries.size)
                },
                color = klinikColor("textSecondary"),
            )

            // Always on screen: a queue is not a way to reach anybody
            // urgently, and somebody deciding to wait should know that.
            Surface(color = klinikColor("warningSurface"), modifier = Modifier.fillMaxWidth()) {
                Text(
                    strings.urgentWarning,
                    color = klinikColor("warning"),
                    modifier = Modifier.padding(Tokens.Spacing.lg),
                )
            }

            Button(
                onClick = onSendNow,
                enabled = !state.sending,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(if (state.sending) strings.sending else strings.sendNow)
            }

            state.conflicts.forEach { conflict ->
                ConflictCard(conflict, strings, onKeepMine, onKeepServer)
            }

            if (state.waiting.isNotEmpty()) {
                Section(strings.waiting) {
                    state.waiting.forEach { entry ->
                        EntryRow(entry, strings, stuck = false) { discarding = it }
                    }
                }
            }

            if (state.stuck.isNotEmpty()) {
                Section(strings.stuck) {
                    // Nothing will move these without a person. Said once,
                    // above the rows, rather than repeated on each.
                    Text(strings.stuckDetail, color = klinikColor("critical"))

                    state.stuck.forEach { entry ->
                        EntryRow(entry, strings, stuck = true) { discarding = it }
                    }
                }
            }
        }
    }

    discarding?.let { entry ->
        AlertDialog(
            onDismissRequest = { discarding = null },
            title = { Text(strings.discardTitle) },
            // What discarding means: the record never reaches the clinic and
            // is gone from the phone. Not a retry, not a pause.
            text = { Text(strings.discardDetail) },
            confirmButton = {
                TextButton(
                    onClick = {
                        onDiscard(entry)
                        discarding = null
                    },
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.discard)
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { discarding = null },
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.cancel)
                }
            },
        )
    }
}

@Composable
private fun EntryRow(
    entry: OutboxEntry,
    strings: PendingChangesStrings,
    stuck: Boolean,
    onDiscard: (OutboxEntry) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = Tokens.Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
    ) {
        // What it is, in the patient's words rather than the table's.
        Text(strings.describe(entry), color = klinikColor("textPrimary"))

        if (entry.attempts > 0) {
            Text(
                strings.attempts(entry.attempts),
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
            )
        }

        // The clinic's own words about why, where there are any: "rejected"
        // with no reason is something nobody can act on.
        entry.lastError?.let {
            Text(
                strings.lastError(it),
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
            )
        }

        if (stuck) {
            TextButton(
                onClick = { onDiscard(entry) },
                modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(strings.discard)
            }
        }
    }
}

/**
 * A record the clinic changed while this phone was away.
 *
 * Both versions are offered and neither is preferred: clinical data is never
 * silently overwritten, which also means the patient's work is never silently
 * thrown away.
 */
@Composable
private fun ConflictCard(
    conflict: SyncConflict,
    strings: PendingChangesStrings,
    onKeepMine: (SyncConflict) -> Unit,
    onKeepServer: (SyncConflict) -> Unit,
) {
    Surface(color = klinikColor("criticalSurface"), modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
        ) {
            Text(
                strings.conflictTitle,
                fontWeight = Tokens.Typography.subheading.weight,
                color = klinikColor("critical"),
                modifier = Modifier.semantics { heading() },
            )

            Text(strings.conflictDetail, color = klinikColor("textPrimary"))

            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
                OutlinedButton(
                    onClick = { onKeepMine(conflict) },
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.keepMine)
                }

                OutlinedButton(
                    onClick = { onKeepServer(conflict) },
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.keepServer)
                }
            }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Surface(color = klinikColor("surface"), modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
        ) {
            Text(
                title,
                fontSize = Tokens.Typography.subheading.size,
                fontWeight = Tokens.Typography.subheading.weight,
                color = klinikColor("textPrimary"),
                modifier = Modifier.semantics { heading() },
            )

            content()
        }
    }
}

@Composable
private fun Centred(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.xl),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { content() }
    }
}
