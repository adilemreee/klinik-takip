package xyz.klinik.feature.messaging.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.messaging.ChatPhase
import xyz.klinik.feature.messaging.ChatState
import xyz.klinik.network.ChatMessage
import xyz.klinik.network.MessageStatus
import xyz.klinik.network.QuickReply
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class ChatStrings(
    val compose: String,
    val send: String,
    val loadOlder: String,
    val typing: String,
    val templates: String,
    val attachment: String,
    val clinicClosed: String,
    val queuedUntil: String,
    val notFound: String,
    val retry: String,
    val statusName: (MessageStatus) -> String,
    val message: (String) -> String,
)

@Composable
fun ChatScreen(
    state: ChatState,
    strings: ChatStrings,
    canUseTemplates: Boolean,
    onRetry: () -> Unit,
    onSend: (String) -> Unit,
    onLoadOlder: () -> Unit,
    onTyping: () -> Unit,
    onPickTemplate: (QuickReply) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            ChatPhase.Loading -> Centered { CircularProgressIndicator() }

            ChatPhase.NotFound -> Centered {
                Text(strings.notFound, color = klinikColor("textSecondary"))
            }

            is ChatPhase.Failed -> Centered {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
                ) {
                    Text(strings.message(phase.messageKey), color = klinikColor("critical"))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            ChatPhase.Empty, ChatPhase.Loaded ->
                Conversation(
                    state,
                    strings,
                    canUseTemplates,
                    onSend,
                    onLoadOlder,
                    onTyping,
                    onPickTemplate,
                )
        }
    }
}

@Composable
private fun Conversation(
    state: ChatState,
    strings: ChatStrings,
    canUseTemplates: Boolean,
    onSend: (String) -> Unit,
    onLoadOlder: () -> Unit,
    onTyping: () -> Unit,
    onPickTemplate: (QuickReply) -> Unit,
) {
    var draft by remember { mutableStateOf("") }

    Column(modifier = Modifier.fillMaxSize()) {
        // Above everything, before a word is typed. Telling someone their
        // message was held only after they sent it is how "queued" comes to
        // feel like "lost".
        if (state.willBeQueued) {
            val text = state.clinic?.opensAt
                ?.let { "${strings.queuedUntil} $it" }
                ?: strings.clinicClosed

            Surface(color = klinikColor("infoSurface"), contentColor = klinikColor("info")) {
                Text(
                    text,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(Tokens.Spacing.md)
                        .semantics { contentDescription = text },
                )
            }
        }

        LazyColumn(modifier = Modifier.weight(1f).padding(Tokens.Spacing.lg)) {
            if (state.hasOlder) {
                item {
                    TextButton(
                        onClick = onLoadOlder,
                        modifier = Modifier.fillMaxWidth().height(Tokens.minimumTouchTarget),
                    ) {
                        Text(strings.loadOlder)
                    }
                }
            }

            items(state.messages, key = { it.id }) { message ->
                MessageRow(message, strings)
            }

            if (state.typing.isNotEmpty()) {
                item { Text(strings.typing, color = klinikColor("textSecondary")) }
            }
        }

        state.error?.let { error ->
            val text = when (error) {
                is UiText.Key -> strings.message(error.key)
                is UiText.Literal -> error.text
            }

            Text(
                text,
                color = klinikColor("critical"),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Tokens.Spacing.lg)
                    .semantics { contentDescription = text },
            )
        }

        Column(
            modifier = Modifier.padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
        ) {
            if (canUseTemplates && state.quickReplies.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
                    state.quickReplies.take(3).forEach { reply ->
                        TextButton(
                            onClick = {
                                draft = reply.body
                                onPickTemplate(reply)
                            },
                            modifier = Modifier.height(Tokens.minimumTouchTarget),
                        ) {
                            Text(reply.title)
                        }
                    }
                }
            }

            OutlinedTextField(
                value = draft,
                onValueChange = {
                    draft = it
                    onTyping()
                },
                label = { Text(strings.compose) },
                modifier = Modifier.fillMaxWidth(),
            )

            Button(
                onClick = {
                    onSend(draft)
                    draft = ""
                },
                enabled = draft.isNotBlank() && !state.sending,
                modifier = Modifier.fillMaxWidth().height(Tokens.minimumTouchTarget),
            ) {
                Text(strings.send)
            }
        }
    }
}

@Composable
private fun MessageRow(message: ChatMessage, strings: ChatStrings) {
    val text = message.body ?: message.transcript ?: strings.attachment
    val status = strings.statusName(message.status)

    Surface(
        color = klinikColor("surface"),
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = Tokens.Spacing.xs)
            .semantics(mergeDescendants = true) { contentDescription = "$text, $status" },
    ) {
        Column(
            modifier = Modifier.padding(Tokens.Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
        ) {
            Text(
                text,
                color = klinikColor("textPrimary"),
                modifier = Modifier.clearAndSetSemantics {},
            )

            // Status in words rather than ticks: a tick a reader cannot
            // interpret says nothing (spec section 7).
            Text(
                status,
                color = klinikColor(if (message.isQueued) "info" else "textSecondary"),
                modifier = Modifier.clearAndSetSemantics {},
            )
        }
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}
