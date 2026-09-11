package xyz.klinik.feature.finance.ui

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
import xyz.klinik.feature.finance.FinancePhase
import xyz.klinik.feature.finance.FinanceState
import xyz.klinik.network.Currency
import xyz.klinik.network.ExchangeRate
import xyz.klinik.network.FinanceRecord
import xyz.klinik.network.PaymentStatus
import xyz.klinik.network.Totals
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class FinanceStrings(
    val title: String,
    val notPermitted: String,
    val noRecords: String,
    val loadMore: String,
    val currency: String,
    val status: String,
    val allStatuses: String,
    val statusName: (PaymentStatus) -> String,
    val outstandingTitle: String,
    val collectionsTitle: String,
    val ratesTitle: String,
    val ratesNone: String,
    val recordsTitle: String,
    val ageingName: (String) -> String,
    val net: String,
    val paid: String,
    val balance: String,
    val recordPayment: String,
    val reverse: String,
    val recordCount: (Int) -> String,
    val totalsIncomplete: String,
    val message: (UiText) -> String,
)

/**
 * What has been billed and what has been paid (spec M11).
 *
 * The two reports are above the ledger because they are the two questions a
 * clinic actually asks — who owes us, and did the money arrive — and neither
 * is answerable by reading the list. The list is underneath for the one row
 * somebody came to find.
 *
 * Every figure on this screen is a string the server produced. Nothing here
 * adds up.
 */
@Composable
fun FinanceScreen(
    state: FinanceState,
    strings: FinanceStrings,
    onChooseCurrency: (Currency) -> Unit,
    onChooseStatus: (PaymentStatus?) -> Unit,
    onLoadMore: () -> Unit,
    onRecordPayment: (FinanceRecord) -> Unit,
    onReverse: (FinanceRecord) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (state.phase) {
            FinancePhase.Loading -> Centered { CircularProgressIndicator() }

            // Not an error and not a clinic that billed nothing: this account
            // may not see the screen, which reads differently.
            FinancePhase.NotPermitted -> Centered {
                Text(
                    strings.notPermitted,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            FinancePhase.Loaded -> Column(
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

                state.error?.let {
                    Text(strings.message(it), color = klinikColor("critical"))
                }

                Chips(
                    label = strings.currency,
                    options = Currency.entries,
                    chosen = state.currency,
                    name = { it.name },
                    onChoose = onChooseCurrency,
                )

                Chips(
                    label = strings.status,
                    // Null first: "everything" is the state the screen opens in.
                    options = listOf(null) + PaymentStatus.entries,
                    chosen = state.status,
                    name = { it?.let(strings.statusName) ?: strings.allStatuses },
                    onChoose = onChooseStatus,
                )

                state.outstanding?.let { report ->
                    Section(strings.outstandingTitle) {
                        Money(strings.balance, report.outstanding, strings)
                        Text(
                            strings.recordCount(report.recordCount),
                            fontSize = Tokens.Typography.caption.size,
                            color = klinikColor("textSecondary"),
                        )

                        report.ageing.forEach { bucket ->
                            Money(strings.ageingName(bucket.stringKey), bucket.totals, strings)
                        }
                    }
                }

                state.collections?.let { report ->
                    Section(strings.collectionsTitle) {
                        Money(strings.paid, report.received, strings)
                        Money(strings.net, report.net, strings)
                    }
                }

                Section(strings.ratesTitle) {
                    if (state.rates.isEmpty()) {
                        // Why a total is incomplete, said where the totals are
                        // rather than left for somebody to work out.
                        Text(strings.ratesNone, color = klinikColor("warning"))
                    } else {
                        state.rates.forEach { rate -> Rate(rate) }
                    }
                }

                Section(strings.recordsTitle) {
                    if (state.records.isEmpty()) {
                        Text(strings.noRecords, color = klinikColor("textSecondary"))
                    }

                    state.records.forEach { record ->
                        RecordRow(record, state, strings, onRecordPayment, onReverse)
                    }

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
private fun RecordRow(
    record: FinanceRecord,
    state: FinanceState,
    strings: FinanceStrings,
    onRecordPayment: (FinanceRecord) -> Unit,
    onReverse: (FinanceRecord) -> Unit,
) {
    val busy = state.busyId == record.id

    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = Tokens.Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
    ) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                record.patient?.fullName ?: record.procedureName,
                color = klinikColor("textPrimary"),
                modifier = Modifier.weight(1f),
            )
            Text(
                strings.statusName(record.paymentStatus),
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
            )
        }

        Text(
            "${strings.net} ${record.currency.symbol}${record.netAmount} · " +
                "${strings.paid} ${record.currency.symbol}${record.paidAmount} · " +
                "${strings.balance} ${record.currency.symbol}${record.balance}",
            fontSize = Tokens.Typography.caption.size,
            // An overpaid record is not an ordinary one; it is money the clinic
            // owes back, and it should not read like a balance of the same kind.
            color = if (record.isOverpaid) klinikColor("warning") else klinikColor("textSecondary"),
        )

        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
            Button(
                onClick = { onRecordPayment(record) },
                enabled = !busy,
                modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(strings.recordPayment)
            }

            // Only where there is something to undo. A reversal needs a
            // payment, and offering it on a record with none is an offer that
            // can only fail.
            if (record.livePayments.isNotEmpty()) {
                TextButton(
                    onClick = { onReverse(record) },
                    enabled = !busy,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.reverse)
                }
            }
        }
    }
}

@Composable
private fun Rate(rate: ExchangeRate) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(
            "${rate.base.name}/${rate.quote.name}",
            color = klinikColor("textSecondary"),
            modifier = Modifier.weight(1f),
        )
        Text("${rate.rate} · ${rate.validOn}", color = klinikColor("textPrimary"))
    }
}

@Composable
private fun Money(label: String, totals: Totals, strings: FinanceStrings) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(label, color = klinikColor("textSecondary"), modifier = Modifier.weight(1f))
            Text(
                "${totals.currency.symbol}${totals.converted}",
                color = klinikColor("textPrimary"),
            )
        }

        // The field a screen must not skip: a total that reads "128.400 ₺"
        // while two thousand pounds sit outside it has to say so, and then say
        // which.
        if (!totals.complete) {
            Text(
                strings.totalsIncomplete,
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("warning"),
            )

            totals.unconverted.forEach { amount ->
                Text(
                    "${amount.currency.symbol}${amount.amount}",
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("warning"),
                )
            }
        }
    }
}

@Composable
private fun <T> Chips(
    label: String,
    options: List<T>,
    chosen: T,
    name: (T) -> String,
    onChoose: (T) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        Text(
            label,
            fontSize = Tokens.Typography.caption.size,
            color = klinikColor("textSecondary"),
        )

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
private fun Centered(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.xl),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { content() }
    }
}
