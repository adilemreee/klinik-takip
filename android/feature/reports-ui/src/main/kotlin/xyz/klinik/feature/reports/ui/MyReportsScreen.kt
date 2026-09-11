package xyz.klinik.feature.reports.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import xyz.klinik.design.MarkdownText
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.reports.MyReportsPhase
import xyz.klinik.feature.reports.MyReportsState
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class MyReportsStrings(
    val title: String,
    val empty: String,
    val retry: String,
    val generatedAt: String,
    val message: (UiText) -> String,
)

/**
 * The lab interpretations a clinician chose to share (spec M5).
 *
 * There is no risk label and no clinical text on this screen, because the
 * server does not send either: "CRITICAL" on a patient's phone with no
 * clinician attached to it is a verdict. What arrives here is the
 * plain-language half of a report somebody signed off, and the disclaimer
 * travels with it.
 */
@Composable
fun MyReportsScreen(
    state: MyReportsState,
    strings: MyReportsStrings,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            MyReportsPhase.Loading -> Centered { CircularProgressIndicator() }

            // Nothing shared yet is not nothing wrong.
            MyReportsPhase.Empty -> Centered {
                Text(strings.empty, color = klinikColor("textSecondary"))
            }

            is MyReportsPhase.Failed -> Centered {
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

            MyReportsPhase.Loaded -> Column(
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

                state.reports.forEach { report ->
                    Surface(color = klinikColor("surface"), modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(Tokens.Spacing.lg),
                            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
                        ) {
                            Text(
                                "${strings.generatedAt}: ${report.generatedAt.take(10)}",
                                fontSize = Tokens.Typography.caption.size,
                                color = klinikColor("textSecondary"),
                            )

                            MarkdownText(report.contentMd)

                            // The server's own words, carried rather than
                            // rewritten: what the clinic warns a patient about
                            // an AI reading is the clinic's sentence.
                            Text(
                                report.disclaimer,
                                fontSize = Tokens.Typography.footnote.size,
                                color = klinikColor("textSecondary"),
                            )
                        }
                    }
                }
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
