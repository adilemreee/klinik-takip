package xyz.klinik.feature.exports.ui

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
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.exports.ExportsPhase
import xyz.klinik.feature.exports.ExportsState
import xyz.klinik.network.ExportColumn
import xyz.klinik.network.ExportFormat
import xyz.klinik.network.ExportRequest
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class ExportsStrings(
    val title: String,
    val notPermitted: String,
    val newTitle: String,
    val history: String,
    val noHistory: String,
    val columns: String,
    val columnUnavailable: String,
    val chosenCount: (Int) -> String,
    val format: String,
    val formatName: (ExportFormat) -> String,
    val country: String,
    val request: String,
    val download: String,
    val expired: String,
    val notAllowed: String,
    val auditNote: String,
    val linkShortLived: String,
    val omitted: String,
    val statusName: (ExportRequest) -> String,
    /** `{count}` and `{matched}`/`{rows}` filled in by the caller. */
    val omission: (key: String, count: Int) -> String,
    val truncation: (key: String, matched: Int, rows: Int) -> String,
    val message: (UiText) -> String,
)

/**
 * Taking data out of the clinic (spec M12).
 *
 * Two sentences on this screen are the point of it. The audit note is at the
 * top, before anything is ticked: somebody exporting a patient list should
 * know their name is going into a log before they choose the columns, not
 * after. And a file that stopped short of its filter says so where the file
 * is — a spreadsheet that is missing rows and does not admit it is the one
 * nobody catches, because it looks exactly like a complete one and it will be
 * summed.
 */
@Composable
fun ExportsScreen(
    state: ExportsState,
    strings: ExportsStrings,
    nowIso: String,
    onToggleColumn: (String) -> Unit,
    onChooseFormat: (ExportFormat) -> Unit,
    onRequest: (country: String) -> Unit,
    onDownload: (ExportRequest) -> Unit,
    modifier: Modifier = Modifier,
) {
    var country by remember { mutableStateOf("") }

    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (state.phase) {
            ExportsPhase.Loading -> Centered { CircularProgressIndicator() }

            ExportsPhase.NotPermitted -> Centered {
                Text(
                    strings.notPermitted,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            ExportsPhase.Loaded -> Column(
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

                // Before the columns, not after the file: this is what somebody
                // needs to know before they decide to take the data at all.
                Text(strings.auditNote, color = klinikColor("textSecondary"))

                state.error?.let {
                    Text(strings.message(it), color = klinikColor("critical"))
                }

                Section(strings.newTitle) {
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
                    ) {
                        ExportFormat.entries.forEach { option ->
                            FilterChip(
                                selected = option == state.format,
                                onClick = { onChooseFormat(option) },
                                label = { Text(strings.formatName(option)) },
                                modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                            )
                        }
                    }

                    OutlinedTextField(
                        value = country,
                        onValueChange = { country = it },
                        label = { Text(strings.country) },
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Text(
                        strings.chosenCount(state.chosen.size),
                        fontSize = Tokens.Typography.caption.size,
                        color = klinikColor("textSecondary"),
                    )

                    Button(
                        onClick = { onRequest(country) },
                        enabled = !state.busy && state.chosen.isNotEmpty(),
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = Tokens.minimumTouchTarget),
                    ) {
                        Text(strings.request)
                    }
                }

                Section(strings.columns) {
                    state.groupedColumns.forEach { (group, columns) ->
                        Text(
                            group,
                            fontSize = Tokens.Typography.caption.size,
                            color = klinikColor("textSecondary"),
                        )

                        columns.forEach { column ->
                            ColumnRow(column, state, strings, onToggleColumn)
                        }
                    }
                }

                Section(strings.history) {
                    if (state.requests.isEmpty()) {
                        Text(strings.noHistory, color = klinikColor("textSecondary"))
                    }

                    state.requests.forEach { request ->
                        RequestRow(request, strings, nowIso, onDownload)
                    }
                }
            }
        }
    }
}

@Composable
private fun ColumnRow(
    column: ExportColumn,
    state: ExportsState,
    strings: ExportsStrings,
    onToggle: (String) -> Unit,
) {
    // Shown and disabled rather than hidden: a column missing from the list
    // looks like one that does not exist, and somebody will go looking for the
    // data somewhere less careful.
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = Tokens.minimumTouchTarget),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(
            checked = column.key in state.chosen,
            onCheckedChange = { onToggle(column.key) },
            enabled = column.available,
        )

        Column(modifier = Modifier.weight(1f)) {
            Text(
                column.header,
                color = if (column.available) {
                    klinikColor("textPrimary")
                } else {
                    klinikColor("textDisabled")
                },
            )

            if (!column.available) {
                Text(
                    strings.columnUnavailable,
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("textSecondary"),
                )
            }
        }
    }
}

@Composable
private fun RequestRow(
    request: ExportRequest,
    strings: ExportsStrings,
    nowIso: String,
    onDownload: (ExportRequest) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = Tokens.Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
    ) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                request.createdAt?.take(10).orEmpty(),
                color = klinikColor("textSecondary"),
                modifier = Modifier.weight(1f),
            )
            Text(strings.statusName(request), color = klinikColor("textPrimary"))
        }

        request.contents?.let { contents ->
            // What was deliberately left out. A report with omissions is not a
            // complete one, and the reader has to be able to see which.
            if (contents.omissions.isNotEmpty()) {
                Text(
                    strings.omitted,
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("textSecondary"),
                )

                contents.omissions.forEach { omission ->
                    Text(
                        strings.omission(omission.stringKey, omission.count),
                        fontSize = Tokens.Typography.caption.size,
                        color = klinikColor("warning"),
                    )
                }
            }

            contents.truncationKey?.let { key ->
                Text(
                    strings.truncation(key, contents.matched ?: 0, contents.rows ?: 0),
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("warning"),
                )
            }
        }

        when {
            // Produced, delivered and cleaned up on schedule is a success.
            // Showing it as a failure sends somebody looking for a fault that
            // is not there.
            request.hasExpired(nowIso) -> Text(
                strings.expired,
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
            )

            request.isReady(nowIso) -> Column {
                TextButton(
                    onClick = { onDownload(request) },
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.download)
                }

                Text(
                    strings.linkShortLived,
                    fontSize = Tokens.Typography.footnote.size,
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
private fun Centered(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.xl),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { content() }
    }
}
