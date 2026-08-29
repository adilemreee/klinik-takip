package xyz.klinik.feature.lab.ui

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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.lab.LabReviewPhase
import xyz.klinik.feature.lab.LabReviewState
import xyz.klinik.network.LabFlag
import xyz.klinik.network.LabReviewItem
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class LabReviewStrings(
    val notice: String,
    val empty: String,
    val notFound: String,
    val retry: String,
    val confirm: String,
    val correct: String,
    val discard: String,
    val lowConfidence: String,
    val needsMapping: String,
    val flagName: (LabFlag) -> String,
    val message: (String) -> String,
)

@Composable
fun LabReviewScreen(
    state: LabReviewState,
    strings: LabReviewStrings,
    onRetry: () -> Unit,
    onConfirm: (String) -> Unit,
    onCorrect: (LabReviewItem) -> Unit,
    onDiscard: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            LabReviewPhase.Loading -> Centered { CircularProgressIndicator() }

            LabReviewPhase.Empty -> Centered {
                Text(strings.empty, color = klinikColor("textSecondary"))
            }

            LabReviewPhase.NotFound -> Centered {
                Text(strings.notFound, color = klinikColor("textSecondary"))
            }

            is LabReviewPhase.Failed -> Centered {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
                ) {
                    Text(strings.message(phase.messageKey), color = klinikColor("critical"))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            LabReviewPhase.Loaded ->
                Queue(state, strings, onConfirm, onCorrect, onDiscard)
        }
    }
}

@Composable
private fun Queue(
    state: LabReviewState,
    strings: LabReviewStrings,
    onConfirm: (String) -> Unit,
    onCorrect: (LabReviewItem) -> Unit,
    onDiscard: (String) -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        // Said outright, at the top, every time. A reviewer who forgets what
        // this list is will approve it like a report.
        Text(
            strings.notice,
            color = klinikColor("textSecondary"),
            modifier = Modifier.padding(Tokens.Spacing.lg),
        )

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

        LazyColumn(modifier = Modifier.weight(1f)) {
            items(state.items, key = { it.result.id }) { item ->
                ReviewRow(
                    item = item,
                    strings = strings,
                    isWorking = state.working == item.result.id,
                    onConfirm = { onConfirm(item.result.id) },
                    onCorrect = { onCorrect(item) },
                    onDiscard = { onDiscard(item.result.id) },
                )
            }
        }
    }
}

@Composable
private fun ReviewRow(
    item: LabReviewItem,
    strings: LabReviewStrings,
    isWorking: Boolean,
    onConfirm: () -> Unit,
    onCorrect: () -> Unit,
    onDiscard: () -> Unit,
) {
    val reference = item.result.referenceText?.let { " ($it)" } ?: ""
    val flag = item.result.flag?.let { ", ${strings.flagName(it)}" } ?: ""
    val spoken = "${item.result.analyteName}, ${item.result.value} ${item.result.unit}$reference$flag"

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(Tokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
    ) {
        Column(
            modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = spoken },
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
        ) {
            Text(
                item.result.analyteName,
                color = klinikColor("textPrimary"),
                modifier = Modifier.clearAndSetSemantics {},
            )

            Text(
                "${item.result.value} ${item.result.unit}$reference",
                color = item.result.flag?.let { flagColour(it) } ?: klinikColor("textPrimary"),
                modifier = Modifier.clearAndSetSemantics {},
            )
        }

        // The two reasons a row needs a human, in words rather than by colour.
        if (item.needsAttention) {
            Text(strings.lowConfidence, color = klinikColor("warning"))
        }

        if (item.awaitingMapping) {
            Text(strings.needsMapping, color = klinikColor("info"))
        }

        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
            Button(
                onClick = onConfirm,
                enabled = !isWorking,
                modifier = Modifier.height(Tokens.minimumTouchTarget),
            ) {
                Text(strings.confirm)
            }

            TextButton(
                onClick = onCorrect,
                enabled = !isWorking,
                modifier = Modifier.height(Tokens.minimumTouchTarget),
            ) {
                Text(strings.correct)
            }

            TextButton(
                onClick = onDiscard,
                enabled = !isWorking,
                modifier = Modifier.height(Tokens.minimumTouchTarget),
            ) {
                Text(strings.discard)
            }
        }
    }
}

/**
 * Colour supports the words; it never carries the meaning alone, because a flag
 * a reader cannot distinguish by hue is no flag at all (spec section 7).
 */
@Composable
private fun flagColour(flag: LabFlag) = klinikColor(
    when (flag) {
        LabFlag.NORMAL -> "success"
        LabFlag.LOW, LabFlag.HIGH -> "warning"
        LabFlag.CRITICAL -> "critical"
    },
)

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}
