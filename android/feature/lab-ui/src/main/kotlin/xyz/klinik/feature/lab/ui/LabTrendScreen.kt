package xyz.klinik.feature.lab.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import xyz.klinik.charts.ChartGeometry
import xyz.klinik.charts.Plot
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.lab.LabTrendPhase
import xyz.klinik.feature.lab.LabTrendState
import xyz.klinik.network.AnalyteTrend
import xyz.klinik.network.LabFlag
import xyz.klinik.network.LabResult

/** Text the screen needs, resolved by the caller from string resources. */
data class LabTrendStrings(
    val empty: String,
    val notFound: String,
    val retry: String,
    val latest: String,
    val reference: String,
    val rangesDiffer: String,
    val criticalTitle: String,
    val flagName: (LabFlag) -> String,
    val message: (String) -> String,
)

@Composable
fun LabTrendScreen(
    state: LabTrendState,
    strings: LabTrendStrings,
    onRetry: () -> Unit,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            LabTrendPhase.Loading -> Centered { CircularProgressIndicator() }

            LabTrendPhase.Empty -> Centered {
                Text(strings.empty, color = klinikColor("textSecondary"))
            }

            LabTrendPhase.NotFound -> Centered {
                Text(strings.notFound, color = klinikColor("textSecondary"))
            }

            is LabTrendPhase.Failed -> Centered {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
                ) {
                    Text(strings.message(phase.messageKey), color = klinikColor("critical"))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            LabTrendPhase.Loaded -> Loaded(state, strings, onSelect)
        }
    }
}

@Composable
private fun Loaded(
    state: LabTrendState,
    strings: LabTrendStrings,
    onSelect: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Tokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
    ) {
        // Above the charts, always. A critical value a doctor has to go looking
        // for is one they can miss.
        if (state.critical.isNotEmpty()) {
            CriticalStrip(state.critical, strings)
        }

        AnalytePicker(state, onSelect)

        state.selectedTrend?.let { trend ->
            TrendChart(trend)
            TrendSummary(trend, strings)
        }
    }
}

@Composable
private fun AnalytePicker(state: LabTrendState, onSelect: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        state.trends.forEach { trend ->
            val label = "${trend.analyteName} (${trend.unit})"

            if (trend.id == state.selectedTrend?.id) {
                Button(
                    onClick = { onSelect(trend.id) },
                    modifier = Modifier.fillMaxWidth().height(Tokens.minimumTouchTarget),
                ) {
                    Text(label)
                }
            } else {
                TextButton(
                    onClick = { onSelect(trend.id) },
                    modifier = Modifier.fillMaxWidth().height(Tokens.minimumTouchTarget),
                ) {
                    Text(label)
                }
            }
        }
    }
}

@Composable
private fun TrendChart(trend: AnalyteTrend) {
    val line = klinikColor("accent")
    val band = klinikColor("successSurface")
    val border = klinikColor("border")
    val critical = klinikColor("critical")
    val warning = klinikColor("warning")

    val reference = trend.reference?.let { ref ->
        val low = ref.low
        val high = ref.high
        if (low != null && high != null) low..high else null
    }

    val plot = ChartGeometry.plot(trend.points.map { it.value }, reference = reference)
    val flags = trend.points.map { it.flag }

    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(220.dp)
            // A plot is invisible to a screen reader however it is drawn, so
            // the summary below carries the same information in words and the
            // canvas itself is skipped.
            .clearAndSetSemantics {},
    ) {
        drawTrend(plot, flags, line, band, border, critical, warning)
    }
}

/**
 * The series, with its reference band behind it.
 *
 * The band is drawn only when the backend said every point shares one range.
 * Drawing the latest range across older points would put them on the wrong
 * side of a line they were never compared to.
 */
private fun DrawScope.drawTrend(
    plot: Plot,
    flags: List<LabFlag?>,
    line: Color,
    band: Color,
    border: Color,
    critical: Color,
    warning: Color,
) {
    if (plot.points.isEmpty()) return

    plot.band?.let {
        drawRect(
            color = band,
            topLeft = Offset(0f, (it.topY * size.height).toFloat()),
            size = Size(size.width, ((it.bottomY - it.topY) * size.height).toFloat()),
        )
    }

    fun at(index: Int) = Offset(
        (plot.points[index].x * size.width).toFloat(),
        (plot.points[index].y * size.height).toFloat(),
    )

    plot.points.indices.forEach { index ->
        if (index > 0) {
            drawLine(
                color = line,
                start = at(index - 1),
                end = at(index),
                strokeWidth = 2.dp.toPx(),
            )
        }

        // Colour marks the out-of-range points; the summary underneath says so
        // in words, because colour alone carries nothing for a reader who
        // cannot distinguish it (spec section 7).
        val colour = when (flags.getOrNull(index)) {
            LabFlag.CRITICAL -> critical
            LabFlag.LOW, LabFlag.HIGH -> warning
            else -> line
        }

        drawCircle(color = colour, radius = 4.dp.toPx(), center = at(index))
    }

    drawRect(color = border.copy(alpha = 0.4f), style = Stroke(width = 1.dp.toPx()))
}

@Composable
private fun TrendSummary(trend: AnalyteTrend, strings: LabTrendStrings) {
    val latest = trend.points.lastOrNull()

    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        latest?.let { point ->
            val flag = point.flag?.let { ", ${strings.flagName(it)}" } ?: ""

            Text(
                "${strings.latest}: ${point.value} ${trend.unit}$flag",
                color = klinikColor("textPrimary"),
                modifier = Modifier.semantics {
                    contentDescription = "${trend.analyteName}, ${strings.latest} ${point.value} ${trend.unit}$flag"
                },
            )
        }

        val reference = trend.reference

        if (reference?.low != null && reference.high != null) {
            Text(
                "${strings.reference}: ${reference.low} – ${reference.high} ${trend.unit}",
                color = klinikColor("textSecondary"),
            )
        } else if (trend.points.any { it.refLow != null || it.refHigh != null }) {
            // Said outright rather than silently omitting the band: a missing
            // band otherwise reads as "no reference range".
            Text(strings.rangesDiffer, color = klinikColor("warning"))
        }
    }
}

/** Critical values, above the charts and never only inside one. */
@Composable
private fun CriticalStrip(results: List<LabResult>, strings: LabTrendStrings) {
    Surface(
        color = klinikColor("criticalSurface"),
        contentColor = klinikColor("critical"),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(Tokens.Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
        ) {
            Text(strings.criticalTitle)

            results.forEach { result ->
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
                    Text("${result.analyteName}: ${result.value} ${result.unit}")
                }
            }
        }
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}
