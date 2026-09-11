package xyz.klinik.feature.protocols.ui

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
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
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
import xyz.klinik.feature.protocols.ProtocolsPhase
import xyz.klinik.feature.protocols.ProtocolsState
import xyz.klinik.network.ProtocolSummary
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class ProtocolsStrings(
    val title: String,
    val notPermitted: String,
    val empty: String,
    val explanation: String,
    val retry: String,
    val add: String,
    val addHint: String,
    val documentTitle: String,
    val content: String,
    val procedureType: String,
    val allPatients: String,
    val usable: String,
    val unusable: String,
    val notEmbedded: String,
    val retire: String,
    val retired: String,
    val showRetired: String,
    val chunks: (Int) -> String,
    val message: (UiText) -> String,
)

/**
 * What the assistant is allowed to answer from (spec M4).
 *
 * The explanation is at the top because it is the thing an administrator has
 * to understand before adding anything: the assistant answers from these
 * documents and forwards everything else to a person. A clinic that thinks it
 * is configuring a general-purpose chatbot will upload the wrong things.
 *
 * Documents the server stored but could not index are in their own section.
 * They look identical to working ones, and a clinic reading a single list
 * would believe its assistant had been taught something it has never read.
 */
@Composable
fun ProtocolsScreen(
    state: ProtocolsState,
    strings: ProtocolsStrings,
    onShowRetired: (Boolean) -> Unit,
    onUpload: (title: String, content: String, procedureType: String) -> Unit,
    onRetire: (ProtocolSummary) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var title by remember { mutableStateOf("") }
    var content by remember { mutableStateOf("") }
    var procedure by remember { mutableStateOf("") }

    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            ProtocolsPhase.Loading -> Centered { CircularProgressIndicator() }

            ProtocolsPhase.NotPermitted -> Centered {
                Text(
                    strings.notPermitted,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            is ProtocolsPhase.Failed -> Centered {
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

            ProtocolsPhase.Empty, ProtocolsPhase.Loaded -> Column(
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

                // What the assistant will and will not do, before anything is
                // added: a clinic that thinks this is a general chatbot will
                // upload the wrong things.
                Text(strings.explanation, color = klinikColor("textSecondary"))

                state.error?.let {
                    Text(strings.message(it), color = klinikColor("critical"))
                }

                if (state.phase == ProtocolsPhase.Empty) {
                    // Not an empty list: an assistant with no documents
                    // forwards every question, which is worth saying.
                    Text(strings.empty, color = klinikColor("warning"))
                }

                Section(strings.add) {
                    Text(
                        strings.addHint,
                        fontSize = Tokens.Typography.caption.size,
                        color = klinikColor("textSecondary"),
                    )

                    OutlinedTextField(
                        value = title,
                        onValueChange = { title = it },
                        label = { Text(strings.documentTitle) },
                        modifier = Modifier.fillMaxWidth(),
                    )

                    OutlinedTextField(
                        value = procedure,
                        onValueChange = { procedure = it },
                        label = { Text(strings.procedureType) },
                        modifier = Modifier.fillMaxWidth(),
                    )

                    OutlinedTextField(
                        value = content,
                        onValueChange = { content = it },
                        label = { Text(strings.content) },
                        minLines = 6,
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Button(
                        onClick = {
                            onUpload(title, content, procedure)
                            title = ""
                            content = ""
                            procedure = ""
                        },
                        enabled = !state.busy,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = Tokens.minimumTouchTarget),
                    ) {
                        Text(strings.add)
                    }
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = Tokens.minimumTouchTarget),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Switch(checked = state.showRetired, onCheckedChange = onShowRetired)
                    Text(
                        strings.showRetired,
                        color = klinikColor("textPrimary"),
                        modifier = Modifier.padding(start = Tokens.Spacing.sm),
                    )
                }

                if (state.usable.isNotEmpty()) {
                    Section(strings.usable) {
                        state.usable.forEach { protocol ->
                            DocumentRow(protocol, strings, usable = true, onRetire = onRetire)
                        }
                    }
                }

                if (state.unusable.isNotEmpty()) {
                    Section(strings.unusable) {
                        state.unusable.forEach { protocol ->
                            DocumentRow(protocol, strings, usable = false, onRetire = onRetire)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DocumentRow(
    protocol: ProtocolSummary,
    strings: ProtocolsStrings,
    usable: Boolean,
    onRetire: (ProtocolSummary) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = Tokens.Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
    ) {
        Text(protocol.document.title, color = klinikColor("textPrimary"))

        Text(
            protocol.document.procedureType ?: strings.allPatients,
            fontSize = Tokens.Typography.caption.size,
            color = klinikColor("textSecondary"),
        )

        if (usable) {
            Text(
                strings.chunks(protocol.chunks),
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
            )
        } else if (!protocol.embedded) {
            // Stored and unreachable. Said plainly, because the row is
            // otherwise indistinguishable from one that works.
            Text(
                strings.notEmbedded,
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("warning"),
            )
        }

        if (!protocol.document.isActive) {
            Text(
                strings.retired,
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
            )
        } else {
            TextButton(
                onClick = { onRetire(protocol) },
                modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(strings.retire)
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
private fun Centered(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.xl),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { content() }
    }
}
