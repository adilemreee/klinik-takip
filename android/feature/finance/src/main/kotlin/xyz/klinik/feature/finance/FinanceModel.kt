package xyz.klinik.feature.finance

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.CollectionReport
import xyz.klinik.network.Currency
import xyz.klinik.network.ExchangeRate
import xyz.klinik.network.FinanceApi
import xyz.klinik.network.FinanceRecord
import xyz.klinik.network.OutstandingReport
import xyz.klinik.network.PaymentMethod
import xyz.klinik.network.PaymentStatus
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface FinancePhase {
    data object Loading : FinancePhase
    data object Loaded : FinancePhase

    /** Not a failure: an account without `finance.read` has no screen here. */
    data object NotPermitted : FinancePhase
}

data class FinanceState(
    val phase: FinancePhase = FinancePhase.Loading,
    val currency: Currency = Currency.TRY,
    /** Null means "everything" — the picker's first option. */
    val status: PaymentStatus? = null,
    val records: List<FinanceRecord> = emptyList(),
    val nextCursor: String? = null,
    val outstanding: OutstandingReport? = null,
    val collections: CollectionReport? = null,
    /**
     * The rates recorded for the month the collections cover.
     *
     * Empty is a real answer and the screen says so: it is why a total is
     * incomplete, and a reader looking at a figure that excludes two thousand
     * pounds deserves to know which.
     */
    val rates: List<ExchangeRate> = emptyList(),
    val busyId: String? = null,
    val error: UiText? = null,
) {
    val hasMore: Boolean get() = nextCursor != null
}

/**
 * What has been billed and what has been paid (spec M11).
 *
 * Four reads: the ledger, what is still owed with its ageing, what came in
 * this month, and the rates behind that month. Together they answer the two
 * questions a clinic asks of a finance screen — who owes us, and did the money
 * arrive — and neither is answerable from the record list alone.
 *
 * Nothing here computes money. Every figure is a string the server produced
 * from a decimal, and the client renders it. Arithmetic in the client would be
 * arithmetic in a second place, and the two would eventually disagree in front
 * of a patient.
 */
class FinanceModel(
    private val api: FinanceApi,
    private val clock: () -> Instant = Instant::now,
    private val zone: ZoneId = ZoneId.systemDefault(),
) {
    private val _state = MutableStateFlow(FinanceState())
    val state: StateFlow<FinanceState> = _state.asStateFlow()

    suspend fun load() = coroutineScope {
        val current = _state.value

        _state.value = current.copy(phase = FinancePhase.Loading)

        val (from, to) = thisMonth()

        val page = async { optional { api.records(current.status, current.currency) } }
        val outstanding = async { optional { api.outstanding(current.currency) } }
        val collections = async { optional { api.collections(from, to, current.currency) } }
        val rates = async { optional { api.rates(from, to) } }

        val ledger = page.await()
        val owed = outstanding.await()
        val taken = collections.await()

        _state.value = current.copy(
            phase = if (ledger == null && owed == null && taken == null) {
                FinancePhase.NotPermitted
            } else {
                FinancePhase.Loaded
            },
            records = ledger?.items.orEmpty(),
            nextCursor = ledger?.nextCursor,
            outstanding = owed,
            collections = taken,
            rates = rates.await().orEmpty(),
        )
    }

    suspend fun loadMore() {
        val cursor = _state.value.nextCursor ?: return
        val current = _state.value
        val page = optional { api.records(current.status, current.currency, cursor) } ?: return

        _state.value = _state.value.copy(
            records = _state.value.records + page.items,
            nextCursor = page.nextCursor,
        )
    }

    suspend fun choose(currency: Currency) {
        _state.value = _state.value.copy(currency = currency)
        load()
    }

    suspend fun choose(status: PaymentStatus?) {
        _state.value = _state.value.copy(status = status)
        load()
    }

    /**
     * Records money that arrived.
     *
     * The row is replaced with what the server returned rather than with a
     * locally adjusted balance: subtracting here would be the second place
     * this clinic does arithmetic, and the two would eventually disagree in
     * front of a patient.
     */
    suspend fun pay(
        recordId: String,
        amount: String,
        method: PaymentMethod,
        reference: String?,
    ): Boolean {
        _state.value = _state.value.copy(busyId = recordId, error = null)

        return try {
            val updated = api.recordPayment(recordId, amount, method, reference = reference)

            replace(updated)
            refreshTotals()

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busyId = null, error = messageFor(error))
            false
        }
    }

    /**
     * Reverses a payment (spec M11).
     *
     * The row stays and stops counting — the server's design, and the right
     * one: a payment that was entered and undone is part of what happened, and
     * a ledger that forgets its corrections is a ledger nobody can audit. The
     * reason is required for the same reason.
     */
    suspend fun reverse(paymentId: String, reason: String): Boolean {
        val trimmed = reason.trim()

        if (trimmed.isEmpty()) {
            _state.value = _state.value.copy(error = UiText.Key("finance.reverseNeedsReason"))
            return false
        }

        _state.value = _state.value.copy(busyId = paymentId, error = null)

        return try {
            val updated = api.reversePayment(paymentId, trimmed)

            replace(updated)
            refreshTotals()

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busyId = null, error = messageFor(error))
            false
        }
    }

    private fun replace(updated: FinanceRecord) {
        _state.value = _state.value.copy(
            records = _state.value.records.map { if (it.id == updated.id) updated else it },
            busyId = null,
        )
    }

    /** The ageing and the month's takings both moved. */
    private suspend fun refreshTotals() {
        val currency = _state.value.currency
        val (from, to) = thisMonth()

        _state.value = _state.value.copy(
            outstanding = optional { api.outstanding(currency) } ?: _state.value.outstanding,
            collections = optional { api.collections(from, to, currency) } ?: _state.value.collections,
        )
    }

    /** The window the collections and the rates both cover, so they read together. */
    private fun thisMonth(): Pair<String, String> {
        val moment = ZonedDateTime.ofInstant(clock(), zone)
        val start = moment.withDayOfMonth(1).toLocalDate().atStartOfDay(zone)

        return start.toInstant().toString() to moment.toInstant().toString()
    }

    private suspend fun <T> optional(work: suspend () -> T): T? =
        runCatching { work() }.getOrNull()

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
