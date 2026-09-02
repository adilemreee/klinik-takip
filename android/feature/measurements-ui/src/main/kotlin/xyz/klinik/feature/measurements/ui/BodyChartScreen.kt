package xyz.klinik.feature.measurements.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.util.Locale
import xyz.klinik.charts.ChartGeometry
import xyz.klinik.charts.Plot
import xyz.klinik.charts.PlotPoint
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.measurements.ChartPhase
import xyz.klinik.feature.measurements.MeasurementsState

import xyz.klinik.network.BmiCategory
import xyz.klinik.network.BodyChart

/** Which curve the chart is showing. Two units cannot share one readable plot. */
enum class ChartSeries { WEIGHT, BMI }

/** Text the screen needs, resolved by the caller from string resources. */
data class MeasurementStrings(
    val weight: String,
    val bmi: String,
    val target: String,
    val latest: String,
    val add: String,
    val empty: String,
    val notFound: String,
    val retry: String,
    val loading: String,
    val categoryName: (BmiCategory) -> String,
    val message: (String) -> String,
)

@Composable
fun BodyChartScreen(
    state: MeasurementsState,
    strings: MeasurementStrings,
    canRecord: Boolean,
    onRetry: () -> Unit,
    onAdd: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var series by remember { mutableStateOf(ChartSeries.WEIGHT) }

    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            ChartPhase.Loading -> Centered { CircularProgressIndicator() }

            ChartPhase.Empty -> Centered {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
                ) {
                    Text(strings.empty, color = klinikColor("textSecondary"))
                    if (canRecord) TextButton(onClick = onAdd) { Text(strings.add) }
                }
            }

            ChartPhase.NotFound -> Centered {
                Text(strings.notFound, color = klinikColor("textSecondary"))
            }

            is ChartPhase.Failed -> Centered {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
                ) {
                    Text(strings.message(phase.messageKey), color = klinikColor("critical"))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            is ChartPhase.Loaded -> Loaded(
                chart = phase.chart,
                series = series,
                onSeriesChange = { series = it },
                strings = strings,
                canRecord = canRecord,
                onAdd = onAdd,
            )
        }
    }
}

@Composable
private fun Loaded(
    chart: BodyChart,
    series: ChartSeries,
    onSeriesChange: (ChartSeries) -> Unit,
    strings: MeasurementStrings,
    canRecord: Boolean,
    onAdd: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
    ) {
        SeriesSelector(series, strings, onSeriesChange)

        val values = when (series) {
            ChartSeries.WEIGHT -> chart.weight.map { it.value }
            ChartSeries.BMI -> chart.bmi.map { it.bmi }
        }
        val goal = when (series) {
            ChartSeries.WEIGHT -> chart.targetWeightKg
            ChartSeries.BMI -> chart.targetBmi
        }

        val lineColor = klinikColor("accent")
        val goalColor = klinikColor("textSecondary")

        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(220.dp)
                // A plot is invisible to a screen reader no matter how it is
                // drawn, so the reading below carries the same information in
                // words and the canvas itself is skipped.
                .clearAndSetSemantics {},
        ) {
            drawCurve(ChartGeometry.plot(values, goal), lineColor, goalColor)
        }

        // The same information in words: the summary is the accessible copy of
        // the chart, not a decoration beside it.
        LatestReading(chart, series, strings)

        if (series == ChartSeries.BMI) {
            chart.bmi.lastOrNull()?.let { point ->
                BmiBadge(point.bmi, point.category, strings)
            }
        }

        Box(modifier = Modifier.fillMaxWidth().padding(top = Tokens.Spacing.lg)) {
            if (canRecord) {
                Button(
                    onClick = onAdd,
                    modifier = Modifier.fillMaxWidth().height(Tokens.minimumTouchTarget),
                ) {
                    Text(strings.add)
                }
            }
        }
    }
}

/**
 * The curve, and the clinic's goal drawn across it.
 *
 * Drawn rather than charted with a library: one line and one rule do not
 * justify pulling a charting dependency into a clinical app, where every
 * dependency is something that has to be watched for advisories. The scaling
 * lives in ChartGeometry, in the plain-Kotlin module, where it is tested — a
 * curve drawn against the wrong scale still looks like a curve.
 */
private fun DrawScope.drawCurve(plot: Plot, lineColor: Color, goalColor: Color) {
    if (plot.points.isEmpty()) return

    fun at(point: PlotPoint) =
        Offset((point.x * size.width).toFloat(), (point.y * size.height).toFloat())

    plot.goalY?.let { goalY ->
        val y = (goalY * size.height).toFloat()
        drawLine(
            color = goalColor,
            start = Offset(0f, y),
            end = Offset(size.width, y),
            strokeWidth = 1.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 8f)),
        )
    }

    plot.points.forEachIndexed { index, point ->
        if (index > 0) {
            drawLine(
                color = lineColor,
                start = at(plot.points[index - 1]),
                end = at(point),
                strokeWidth = 2.dp.toPx(),
            )
        }

        drawCircle(color = lineColor, radius = 3.dp.toPx(), center = at(point))
    }

    drawRect(color = goalColor.copy(alpha = 0.15f), style = Stroke(width = 1.dp.toPx()))
}

@Composable
private fun LatestReading(
    chart: BodyChart,
    series: ChartSeries,
    strings: MeasurementStrings,
) {
    val text = when (series) {
        ChartSeries.WEIGHT -> chart.weight.lastOrNull()?.let {
            "${strings.latest}: ${format(it.value)} ${it.unit}"
        }
        ChartSeries.BMI -> chart.bmi.lastOrNull()?.let {
            "${strings.latest}: ${format(it.bmi)}"
        }
    }

    text?.let { Text(it, color = klinikColor("textSecondary")) }
}

/**
 * The WHO band in words as well as colour: a meaning the reader cannot
 * distinguish by hue is no meaning at all (spec section 7).
 */
@Composable
private fun BmiBadge(value: Double, category: BmiCategory, strings: MeasurementStrings) {
    val colorName = when (category) {
        BmiCategory.NORMAL -> "success"
        BmiCategory.UNDERWEIGHT, BmiCategory.OVERWEIGHT -> "warning"
        BmiCategory.OBESE_I, BmiCategory.OBESE_II, BmiCategory.OBESE_III -> "critical"
    }

    Surface(
        color = klinikColor("${colorName}Surface"),
        contentColor = klinikColor(colorName),
    ) {
        Text(
            "${format(value)} — ${strings.categoryName(category)}",
            modifier = Modifier
                .padding(horizontal = Tokens.Spacing.md, vertical = Tokens.Spacing.sm)
                .semantics { contentDescription = "${format(value)} ${strings.categoryName(category)}" },
        )
    }
}

/** One decimal, in the reader's own number format — 22,9 in Turkish. */
private fun format(value: Double): String = String.format(Locale.getDefault(), "%.1f", value)

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}

/**
 * Which curve to show. Two plain buttons rather than a chip row: the selected
 * one is filled and the other is not, which reads the same to someone who
 * cannot tell the two colours apart.
 */
@Composable
private fun SeriesSelector(
    series: ChartSeries,
    strings: MeasurementStrings,
    onSeriesChange: (ChartSeries) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
        listOf(ChartSeries.WEIGHT to strings.weight, ChartSeries.BMI to strings.bmi)
            .forEach { (option, label) ->
                if (option == series) {
                    Button(
                        onClick = { onSeriesChange(option) },
                        modifier = Modifier.height(Tokens.minimumTouchTarget),
                    ) {
                        Text(label)
                    }
                } else {
                    TextButton(
                        onClick = { onSeriesChange(option) },
                        modifier = Modifier.height(Tokens.minimumTouchTarget),
                    ) {
                        Text(label)
                    }
                }
            }
    }
}
