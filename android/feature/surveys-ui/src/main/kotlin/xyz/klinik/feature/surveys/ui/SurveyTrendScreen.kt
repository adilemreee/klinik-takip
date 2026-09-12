package xyz.klinik.feature.surveys.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import xyz.klinik.charts.ChartGeometry
import xyz.klinik.charts.Plot
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.surveys.SurveyTrendPhase
import xyz.klinik.feature.surveys.SurveyTrendState
import xyz.klinik.network.SurveyFinding
import xyz.klinik.network.SurveyPoint
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class SurveyTrendStrings(
    val title: String,
    val noAnswers: String,
    val noTrend: String,
    val retry: String,
    val partial: String,
    val findingName: (SurveyFinding) -> String,
    /** "Ameliyattan {days} gün sonra", with the number already in it. */
    val milestone: (Int) -> String,
    /** "Bu yanıtta {answered}/{total} soru cevaplanmış". */
    val partialDetail: (answered: Int, total: Int) -> String,
    val message: (UiText) -> String,
)

/**
 * How a patient's own answers have moved (spec M18).
 *
 * The findings are above the chart, because they are what a clinician came to
 * read: a finding is the server's comparison of this patient against
 * themselves — "worse than last time, by enough to mean something" — and the
 * line is how somebody checks it, not the other way round.
 *
 * One response is drawn as one point and labelled as no trend. A single dot on
 * an axis invites a reader to see a direction that is not there.
 */
@Composable
fun SurveyTrendScreen(
    state: SurveyTrendState,
    strings: SurveyTrendStrings,
    onChooseQuestion: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            SurveyTrendPhase.Loading -> Centred { CircularProgressIndicator() }

            // A real answer about this patient, not a failure.
            SurveyTrendPhase.Empty -> Centred {
                Text(
                    strings.noAnswers,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            is SurveyTrendPhase.Failed -> Centred {
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

            SurveyTrendPhase.Loaded -> Column(
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

                // Before the chart: the comparison is the finding, and the
                // line is how a clinician checks it.
                state.findings.forEach { finding ->
                    Surface(
                        color = klinikColor("warningSurface"),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(
                            modifier = Modifier.padding(Tokens.Spacing.lg),
                            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
                        ) {
                            Text(finding.questionText, color = klinikColor("textPrimary"))
                            Text(
                                buildString {
                                    append(strings.findingName(finding))
                                    append(" · ")
                                    append(finding.value)
                                    // The previous answer, where there is one:
                                    // "worsened" means nothing without it.
                                    finding.previous?.let { append(" (← $it)") }
                                },
                                fontSize = Tokens.Typography.caption.size,
                                color = klinikColor("warning"),
                            )
                        }
                    }
                }

                if (state.chartable.size > 1) {
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
                    ) {
                        state.chartable.forEach { question ->
                            FilterChip(
                                selected = question.id == state.question?.id,
                                onClick = { onChooseQuestion(question.id) },
                                label = { Text(question.text) },
                                modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                            )
                        }
                    }
                }

                state.question?.let { question ->
                    Section(question.text) {
                        if (!state.hasTrend) {
                            // Said rather than drawn: one dot on an axis reads
                            // as the start of a line that is missing.
                            Text(strings.noTrend, color = klinikColor("textSecondary"))
                        }

                        TrendChart(state.points.map { it.second })

                        // The numbers in words, because a canvas is invisible
                        // to a screen reader however it is drawn.
                        state.points.forEach { (point, value) ->
                            PointRow(point, value, strings)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PointRow(point: SurveyPoint, value: Int, strings: SurveyTrendStrings) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                strings.milestone(point.milestoneDays),
                color = klinikColor("textSecondary"),
                modifier = Modifier.weight(1f),
            )
            Text(value.toString(), color = klinikColor("textPrimary"))
        }

        // A response with most of it blank must not sit beside a full one
        // unmarked: one answer out of five reads as a complete assessment.
        if (point.partial) {
            Text(
                "${strings.partial} · ${strings.partialDetail(point.answeredCount, point.questionCount)}",
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("warning"),
            )
        }
    }
}

@Composable
private fun TrendChart(values: List<Int>) {
    if (values.isEmpty()) return

    val plot = ChartGeometry.plot(values.map { it.toDouble() })
    val line = klinikColor("accent")
    val dot = klinikColor("textPrimary")

    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(180.dp)
            // Skipped by a screen reader: the rows underneath carry the same
            // information in words.
            .clearAndSetSemantics {},
    ) {
        drawSeries(plot, line, dot)
    }
}

private fun DrawScope.drawSeries(plot: Plot, line: Color, dot: Color) {
    fun at(index: Int) = Offset(
        (plot.points[index].x * size.width).toFloat(),
        (plot.points[index].y * size.height).toFloat(),
    )

    for (index in 1 until plot.points.size) {
        drawLine(color = line, start = at(index - 1), end = at(index), strokeWidth = 4f)
    }

    plot.points.indices.forEach { index -> drawCircle(color = dot, radius = 6f, center = at(index)) }
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
