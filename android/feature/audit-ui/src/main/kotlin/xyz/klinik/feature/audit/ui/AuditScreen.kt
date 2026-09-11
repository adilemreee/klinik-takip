package xyz.klinik.feature.audit.ui

import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.audit.AuditPhase
import xyz.klinik.feature.audit.AuditState
import xyz.klinik.network.AuditAction
import xyz.klinik.network.AuditAnomaly
import xyz.klinik.network.AuditEntry
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class AuditStrings(
    val title: String,
    val notPermitted: String,
    val empty: String,
    val retry: String,
    val trail: String,
    val anomalies: String,
    val anomaliesHint: String,
    val anonymous: String,
    val allActions: String,
    val actionName: (AuditAction) -> String,
    val anomalyName: (AuditAnomaly) -> String,
    val roleName: (String) -> String,
    /**
     * The table's own name, translated when the app knows it and verbatim when
     * it does not — a log that hides a row it cannot translate has an
     * invisible gap in it.
     */
    val entityName: (AuditEntry) -> String,
    val loadMore: String,
    val message: (UiText) -> String,
)

/**
 * Who did what to whose record (spec M13).
 *
 * The anomalies are at the top, not at the bottom: they are the reason
 * somebody opens this screen at all. "A nurse read a hundred and twenty files
 * last night" is not a row anybody would find by scrolling a log, and a
 * section below three hundred entries is a section nobody reaches.
 */
@Composable
fun AuditScreen(
    state: AuditState,
    strings: AuditStrings,
    onChooseAction: (AuditAction?) -> Unit,
    onLoadMore: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            AuditPhase.Loading -> Centered { CircularProgressIndicator() }

            AuditPhase.NotPermitted -> Centered {
                Text(
                    strings.notPermitted,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            is AuditPhase.Failed -> Centered {
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

            AuditPhase.Empty, AuditPhase.Loaded -> Column(
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

                if (state.anomalies.isNotEmpty()) {
                    Section(strings.anomalies) {
                        Text(
                            strings.anomaliesHint,
                            fontSize = Tokens.Typography.caption.size,
                            color = klinikColor("textSecondary"),
                        )

                        state.anomalies.forEach { anomaly ->
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = Tokens.Spacing.xs),
                            ) {
                                Text(
                                    strings.anomalyName(anomaly),
                                    color = klinikColor("critical"),
                                )
                                // The server's own sentence. It knows what it
                                // counted; re-wording it here would describe a
                                // pattern the client did not detect.
                                Text(
                                    anomaly.detail,
                                    fontSize = Tokens.Typography.caption.size,
                                    color = klinikColor("textSecondary"),
                                )
                            }
                        }
                    }
                }

                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
                ) {
                    // Null first: the whole log is what the screen opens on.
                    (listOf(null) + AuditAction.entries).forEach { option ->
                        FilterChip(
                            selected = option == state.action,
                            onClick = { onChooseAction(option) },
                            label = {
                                Text(option?.let(strings.actionName) ?: strings.allActions)
                            },
                            modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                        )
                    }
                }

                Section(strings.trail) {
                    if (state.entries.isEmpty()) {
                        Text(strings.empty, color = klinikColor("textSecondary"))
                    }

                    state.entries.forEach { entry -> EntryRow(entry, strings) }

                    if (state.hasMore) {
                        TextButton(
                            onClick = onLoadMore,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = Tokens.minimumTouchTarget),
                        ) {
                            Text(strings.loadMore)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EntryRow(entry: AuditEntry, strings: AuditStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = Tokens.Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
    ) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                strings.actionName(entry.action),
                // The five worth a second look are marked, in a word as well
                // as a colour: an export a reader can only tell apart by hue
                // is no signal at all (spec section 7).
                color = if (entry.action.isNotable) {
                    klinikColor("warning")
                } else {
                    klinikColor("textPrimary")
                },
                fontWeight = if (entry.action.isNotable) {
                    Tokens.Typography.subheading.weight
                } else {
                    Tokens.Typography.body.weight
                },
                modifier = Modifier.weight(1f),
            )
            Text(
                entry.createdAt.take(19).replace('T', ' '),
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
            )
        }

        Text(
            buildString {
                // Anonymous is said, not left blank: a failed sign-in with an
                // unknown identifier is exactly the row somebody is looking
                // for, and a blank reads as missing data.
                append(entry.roleKey?.let(strings.roleName) ?: strings.anonymous)
                append(" · ")
                append(strings.entityName(entry))
            },
            fontSize = Tokens.Typography.caption.size,
            color = klinikColor("textSecondary"),
        )
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
