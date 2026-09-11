package xyz.klinik.feature.lab.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import xyz.klinik.feature.lab.LabPanelsPhase
import xyz.klinik.feature.lab.LabPanelsState
import xyz.klinik.network.LabFlag
import xyz.klinik.network.LabPanel
import xyz.klinik.network.LabResult
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class LabPanelsStrings(
    val title: String,
    val empty: String,
    val retry: String,
    val reference: String,
    val noRange: String,
    val openReport: String,
    val resultCount: (Int) -> String,
    val abnormalCount: (Int) -> String,
    val flagName: (LabFlag) -> String,
    val toggleHint: String,
    val expanded: String,
    val collapsed: String,
    val message: (UiText) -> String,
)

/**
 * Confirmed results, as the laboratory printed them (spec M16).
 *
 * One sheet per blood draw, newest open. Scattering these rows into
 * per-analyte lists would make a clinician reassemble what the laboratory
 * already grouped — the trend chart is the other view, and answers a
 * different question.
 *
 * A value outside its range is marked in a word as well as a colour, because
 * a reader who cannot distinguish hue has no signal from colour alone (spec
 * section 7). A value with no printed range says so rather than being drawn
 * as normal.
 */
@Composable
fun LabPanelsScreen(
    state: LabPanelsState,
    strings: LabPanelsStrings,
    onToggle: (LabPanel) -> Unit,
    onOpenReport: (LabPanel) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            LabPanelsPhase.Loading -> Centered { CircularProgressIndicator() }

            // Nothing confirmed is not nothing uploaded: a document sits
            // unverified until a clinician confirms the readings, and saying
            // so is the difference between waiting and lost.
            LabPanelsPhase.Empty -> Centered {
                Text(
                    strings.empty,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            is LabPanelsPhase.Failed -> Centered {
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

            LabPanelsPhase.Loaded -> Column(
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

                state.panels.forEach { panel ->
                    PanelCard(panel, state.isExpanded(panel), strings, onToggle, onOpenReport)
                }
            }
        }
    }
}

@Composable
private fun PanelCard(
    panel: LabPanel,
    expanded: Boolean,
    strings: LabPanelsStrings,
    onToggle: (LabPanel) -> Unit,
    onOpenReport: (LabPanel) -> Unit,
) {
    val abnormal = panel.results.count {
        it.flag == LabFlag.HIGH || it.flag == LabFlag.LOW || it.flag == LabFlag.CRITICAL
    }

    Surface(color = klinikColor("surface"), modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
        ) {
            val spoken = buildString {
                append(panel.measuredAt.take(10))
                append(", ")
                append(strings.resultCount(panel.results.size))
                if (abnormal > 0) {
                    append(", ")
                    append(strings.abnormalCount(abnormal))
                }
                append(", ")
                append(if (expanded) strings.expanded else strings.collapsed)
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = Tokens.minimumTouchTarget)
                    .clickable { onToggle(panel) }
                    .semantics(mergeDescendants = true) { contentDescription = spoken },
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        panel.measuredAt.take(10),
                        color = klinikColor("textPrimary"),
                        modifier = Modifier.semantics { heading() },
                    )
                    Text(
                        strings.resultCount(panel.results.size),
                        fontSize = Tokens.Typography.caption.size,
                        color = klinikColor("textSecondary"),
                    )
                }

                // How many are out of range, on the closed row: the point of a
                // collapsed sheet is deciding whether to open it.
                if (abnormal > 0) {
                    Text(
                        strings.abnormalCount(abnormal),
                        fontSize = Tokens.Typography.caption.size,
                        color = if (panel.hasCritical) {
                            klinikColor("critical")
                        } else {
                            klinikColor("warning")
                        },
                    )
                }
            }

            if (!expanded) return@Column

            panel.results.forEach { result -> ResultRow(result, strings) }

            // Only where there is a file. A download that always fails looks
            // like a broken app rather than a missing document.
            if (panel.documentAvailable) {
                TextButton(
                    onClick = { onOpenReport(panel) },
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.openReport)
                }
            }
        }
    }
}

@Composable
private fun ResultRow(result: LabResult, strings: LabPanelsStrings) {
    val tone = when (result.flag) {
        LabFlag.CRITICAL -> "critical"
        LabFlag.HIGH, LabFlag.LOW -> "warning"
        else -> "textPrimary"
    }

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                result.analyteName,
                color = klinikColor("textPrimary"),
                modifier = Modifier.weight(1f),
            )
            Text("${result.value} ${result.unit}", color = klinikColor(tone))
        }

        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                // A range, or the fact that the report printed none. Not
                // silence: unclassified and normal are different answers.
                result.referenceText?.let { "${strings.reference}: $it" } ?: strings.noRange,
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
                modifier = Modifier.weight(1f),
            )

            // The word as well as the colour.
            result.flag?.let {
                Text(
                    strings.flagName(it),
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor(tone),
                )
            }
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
