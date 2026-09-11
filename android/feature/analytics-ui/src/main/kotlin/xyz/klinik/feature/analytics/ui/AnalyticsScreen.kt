package xyz.klinik.feature.analytics.ui

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
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.analytics.AnalyticsPhase
import xyz.klinik.feature.analytics.AnalyticsState
import xyz.klinik.feature.analytics.ReportRange
import xyz.klinik.network.Currency
import xyz.klinik.network.NamedCount
import xyz.klinik.network.Proportion
import xyz.klinik.network.Totals

/** Text the screen needs, resolved by the caller from string resources. */
data class AnalyticsStrings(
    val title: String,
    val notPermitted: String,
    val nothingInRange: String,
    val range: String,
    val rangeName: (ReportRange) -> String,
    val procedures: String,
    val geography: String,
    val revenue: String,
    val channels: String,
    val occupancy: String,
    val tooFew: String,
    val net: String,
    val cost: String,
    val commission: String,
    val margin: String,
    val conversion: String,
    val cityUnknown: (Int) -> String,
    val totalOperations: (Int) -> String,
    val patientCount: (Int) -> String,
    /** Catalogue keys the reports ask for by name — caveats and notices. */
    val notice: (String) -> String,
)

/**
 * The clinic's numbers (spec M11).
 *
 * Every proportion on this screen can be absent, and each absence has to say
 * why rather than render as zero. "Not enough cases to state a share" and "0%"
 * are different claims, and only one of them is supported by the data.
 */
@Composable
fun AnalyticsScreen(
    state: AnalyticsState,
    strings: AnalyticsStrings,
    onChooseRange: (ReportRange) -> Unit,
    onChooseCurrency: (Currency) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (state.phase) {
            AnalyticsPhase.Loading -> Centered { CircularProgressIndicator() }

            // Not an error and not an empty clinic: this account is not
            // allowed to see the panel, which reads differently.
            AnalyticsPhase.NotPermitted -> Centered {
                Text(
                    strings.notPermitted,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            AnalyticsPhase.Loaded -> Column(
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

                Chips(
                    label = strings.range,
                    options = ReportRange.entries,
                    chosen = state.range,
                    name = strings.rangeName,
                    onChoose = onChooseRange,
                )

                Chips(
                    label = "",
                    options = Currency.entries,
                    chosen = state.currency,
                    name = { it.name },
                    onChoose = onChooseCurrency,
                )

                state.procedures?.let { report ->
                    Section(strings.procedures) {
                        Text(
                            strings.totalOperations(report.total),
                            color = klinikColor("textPrimary"),
                        )

                        report.byProcedure.forEach { Distribution(it, strings) }
                    }
                }

                state.geography?.let { report ->
                    Section(strings.geography) {
                        report.byCountry.forEach { Distribution(it, strings) }

                        // Said out loud, so the shares visibly do not add up
                        // to everybody rather than silently not adding up.
                        if (report.cityUnknown > 0) {
                            Text(
                                strings.cityUnknown(report.cityUnknown),
                                fontSize = Tokens.Typography.caption.size,
                                color = klinikColor("textSecondary"),
                            )
                        }
                    }
                }

                state.revenue?.let { report ->
                    Section(strings.revenue) {
                        Money(strings.net, report.net)
                        Money(strings.cost, report.cost)
                        Money(strings.commission, report.agencyCommission)
                        Money(strings.margin, report.margin)

                        // A margin with unreadable cost lines behind it is a
                        // margin with a caveat, not a number.
                        report.caveatKeys.forEach { key ->
                            Text(strings.notice(key), color = klinikColor("warning"))
                        }
                    }
                }

                state.channels?.let { report ->
                    Section(strings.channels) {
                        // An empty revenue column otherwise reads as "this
                        // channel earned nothing", which is a worse claim than
                        // "you may not see it".
                        report.revenueNoticeKey?.let { key ->
                            Text(strings.notice(key), color = klinikColor("warning"))
                        }

                        report.channels.forEach { row ->
                            Row(modifier = Modifier.fillMaxWidth()) {
                                Text(
                                    row.label,
                                    color = klinikColor("textPrimary"),
                                    modifier = Modifier.weight(1f),
                                )
                                Text(
                                    "${strings.conversion}: ${percent(row.conversion, strings)}",
                                    fontSize = Tokens.Typography.caption.size,
                                    color = klinikColor("textSecondary"),
                                )
                            }
                        }
                    }
                }

                state.occupancy?.let { report ->
                    Section(strings.occupancy) {
                        // No working hours configured is not zero occupancy.
                        report.noticeKey?.let { key ->
                            Text(strings.notice(key), color = klinikColor("warning"))
                        }

                        report.byMonth.forEach { month ->
                            Row(modifier = Modifier.fillMaxWidth()) {
                                Text(
                                    month.month,
                                    color = klinikColor("textPrimary"),
                                    modifier = Modifier.weight(1f),
                                )
                                Text(
                                    percent(month.occupancy, strings),
                                    color = klinikColor("textSecondary"),
                                )
                            }
                        }
                    }
                }

                if (state.procedures?.total == 0) {
                    Text(strings.nothingInRange, color = klinikColor("textSecondary"))
                }
            }
        }
    }
}

/**
 * A proportion, or the reason there is not one.
 *
 * Never "0%": a share the server declined to state because there were too few
 * cases is not a share of nothing.
 */
private fun percent(proportion: Proportion, strings: AnalyticsStrings): String =
    proportion.percent?.let { "%$it" } ?: strings.tooFew

@Composable
private fun <T> Chips(
    label: String,
    options: List<T>,
    chosen: T,
    name: (T) -> String,
    onChoose: (T) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        if (label.isNotEmpty()) {
            Text(
                label,
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
            )
        }

        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
        ) {
            options.forEach { option ->
                FilterChip(
                    selected = option == chosen,
                    onClick = { onChoose(option) },
                    label = { Text(name(option)) },
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
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
private fun Distribution(row: NamedCount, strings: AnalyticsStrings) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(row.label, color = klinikColor("textPrimary"), modifier = Modifier.weight(1f))
        Text(
            "${strings.patientCount(row.count)} · ${percent(row.proportion, strings)}",
            fontSize = Tokens.Typography.caption.size,
            color = klinikColor("textSecondary"),
        )
    }
}

@Composable
private fun Money(label: String, totals: Totals) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(label, color = klinikColor("textSecondary"), modifier = Modifier.weight(1f))
        Text(
            "${totals.currency.symbol}${totals.converted}",
            color = klinikColor("textPrimary"),
            // An incomplete total is marked: some amounts had no rate for
            // their day, so the figure is a floor rather than the sum.
            fontWeight = if (totals.complete) {
                Tokens.Typography.body.weight
            } else {
                Tokens.Typography.subheading.weight
            },
        )
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
