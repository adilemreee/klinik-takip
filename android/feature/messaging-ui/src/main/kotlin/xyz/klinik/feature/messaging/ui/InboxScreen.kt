package xyz.klinik.feature.messaging.ui

import androidx.compose.foundation.clickable
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.messaging.InboxPhase
import xyz.klinik.feature.messaging.InboxState
import xyz.klinik.network.InboxEntry
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class InboxStrings(
    val title: String,
    val empty: String,
    val notPermitted: String,
    val retry: String,
    val waiting: String,
    val open: String,
    val attachment: String,
    val unreadCount: (Int) -> String,
    val message: (UiText) -> String,
)

/**
 * The clinic's conversations (spec M6).
 *
 * The ones waiting on the clinic come first, in their own section: that is the
 * question somebody opens an inbox to answer. The rest stay below rather than
 * being hidden — a conversation with nothing unread is still one a coordinator
 * may need to find.
 *
 * Every row names the patient. This endpoint was being decoded into a bare
 * conversation, which left the screen a list of identifiers and timestamps.
 */
@Composable
fun InboxScreen(
    state: InboxState,
    strings: InboxStrings,
    onOpen: (InboxEntry) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            InboxPhase.Loading -> Centred { CircularProgressIndicator() }

            // A finished inbox, not a failure.
            InboxPhase.Empty -> Centred {
                Text(
                    strings.empty,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            InboxPhase.NotPermitted -> Centred {
                Text(
                    strings.notPermitted,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            is InboxPhase.Failed -> Centred {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(strings.message(phase.message), color = klinikColor("critical"))
                    TextButton(
                        onClick = onRetry,
                        modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                    ) {
                        Text(strings.retry)
                    }
                }
            }

            InboxPhase.Loaded -> Column(
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

                if (state.unread.isNotEmpty()) {
                    Section("${strings.waiting} · ${strings.unreadCount(state.unreadCount)}") {
                        state.unread.forEach { entry -> EntryRow(entry, strings, onOpen) }
                    }
                }

                if (state.read.isNotEmpty()) {
                    Section(strings.open) {
                        state.read.forEach { entry -> EntryRow(entry, strings, onOpen) }
                    }
                }
            }
        }
    }
}

@Composable
private fun EntryRow(entry: InboxEntry, strings: InboxStrings, onOpen: (InboxEntry) -> Unit) {
    val last = entry.lastMessage

    // An attachment with no text is still a message, and a blank line would
    // read as one that failed to load.
    val preview = last?.body ?: last?.let { strings.attachment }.orEmpty()

    val spoken = buildString {
        append(entry.patient.fullName)
        if (entry.hasUnread) {
            append(", ")
            append(strings.unreadCount(entry.unread))
        }
        if (preview.isNotEmpty()) {
            append(", ")
            append(preview)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = Tokens.minimumTouchTarget)
            .clickable { onOpen(entry) }
            .padding(vertical = Tokens.Spacing.xs)
            .semantics(mergeDescendants = true) { contentDescription = spoken },
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
    ) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                entry.patient.fullName,
                color = klinikColor("textPrimary"),
                // Unread is marked in weight as well as a count, because a
                // number a reader has to hunt for is not a signal.
                fontWeight = if (entry.hasUnread) {
                    Tokens.Typography.subheading.weight
                } else {
                    Tokens.Typography.body.weight
                },
                modifier = Modifier.weight(1f),
            )

            if (entry.hasUnread) {
                Text(
                    strings.unreadCount(entry.unread),
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("accent"),
                )
            }
        }

        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                preview,
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
                modifier = Modifier.weight(1f),
            )

            last?.let {
                Text(
                    it.sentAt.take(10),
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("textSecondary"),
                )
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
