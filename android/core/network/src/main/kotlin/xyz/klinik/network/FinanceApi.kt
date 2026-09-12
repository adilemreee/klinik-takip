package xyz.klinik.network

import java.math.BigDecimal
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The finance desk (spec M11, T6.3).
 *
 * Amounts arrive as strings and become `BigDecimal` here. `Double` would lose
 * them: a bill of 4500.10 has no exact binary representation, and a screen that
 * adds a column of them eventually disagrees with the server by a kuruş —
 * which is the one kind of disagreement a finance desk cannot ignore.
 */

@Serializable
enum class Currency {
    TRY,
    EUR,
    USD,
    GBP,
    ;

    /** ₺, €, $, £ — what belongs next to the figure. */
    val symbol: String
        get() = when (this) {
            TRY -> "₺"
            EUR -> "€"
            USD -> "$"
            GBP -> "£"
        }
}

@Serializable
enum class PaymentStatus {
    PENDING,
    PARTIAL,
    PAID,
    REFUNDED,
    CANCELLED,
    ;

    val stringKey: String get() = "finance.status.$name"

    /** Whether the clinic is still waiting for money. */
    val isOutstanding: Boolean get() = this == PENDING || this == PARTIAL
}

@Serializable
enum class PaymentMethod {
    CASH,
    CARD,
    BANK_TRANSFER,
    ONLINE,
    OTHER,
    ;

    val stringKey: String get() = "finance.method.$name"
}

@Serializable
enum class PaymentKind {
    PAYMENT,
    REFUND,
}

@Serializable
data class FinancePatient(
    val id: String,
    val mrn: String,
    val firstName: String,
    val lastName: String,
    val country: String,
) {
    val fullName: String get() = "$firstName $lastName"
}

@Serializable
data class PaymentEntry(
    val id: String,
    val kind: PaymentKind = PaymentKind.PAYMENT,
    val amount: String,
    val currency: Currency,
    /** The same money in the bill's currency. */
    val appliedAmount: String,
    val rate: String? = null,
    val method: PaymentMethod,
    val paidAt: String,
    val reference: String? = null,
    val note: String? = null,
    /** A correction. The row stays; it stops counting. */
    val reversedAt: String? = null,
    val reversalReason: String? = null,
) {
    val isReversed: Boolean get() = reversedAt != null
    val value: BigDecimal get() = BigDecimal(amount)
    val appliedValue: BigDecimal get() = BigDecimal(appliedAmount)
}

@Serializable
data class FinanceRecord(
    val id: String,
    val patientId: String,
    /** Name, file number and country. Nothing clinical. */
    val patient: FinancePatient? = null,
    val procedureName: String,
    val currency: Currency,
    val grossAmount: String,
    val discount: String,
    val netAmount: String,
    val paidAmount: String,
    val refundedAmount: String,
    /** Still owed. Negative when the patient has overpaid. */
    val balance: String,
    val paymentStatus: PaymentStatus,
    val paidAt: String? = null,
    val cancelledAt: String? = null,
    val agencyId: String? = null,
    val agencyName: String? = null,
    val agencyCommission: String? = null,
    val note: String? = null,
    val payments: List<PaymentEntry> = emptyList(),
    val createdAt: String? = null,
) {
    val net: BigDecimal get() = BigDecimal(netAmount)
    val paid: BigDecimal get() = BigDecimal(paidAmount)
    val outstanding: BigDecimal get() = BigDecimal(balance)

    /** Payments that still count. */
    val livePayments: List<PaymentEntry> get() = payments.filter { !it.isReversed }

    val isOverpaid: Boolean get() = outstanding.signum() < 0
}

@Serializable
data class CurrencyAmount(
    val currency: Currency,
    val amount: String,
) {
    val value: BigDecimal get() = BigDecimal(amount)
}

/**
 * A total, and how much of one it is.
 *
 * `unconverted` is the field a screen must not skip. An amount with no rate for
 * its day is reported in its own currency rather than dropped, so a total that
 * reads "128.400 ₺" while two thousand pounds sit outside it says so.
 */
@Serializable
data class Totals(
    val currency: Currency,
    val converted: String,
    /** Every currency present, converted or not. */
    val byCurrency: List<CurrencyAmount> = emptyList(),
    /** What had no rate for its day. Non-empty means `converted` is partial. */
    val unconverted: List<CurrencyAmount> = emptyList(),
    val complete: Boolean = true,
) {
    val value: BigDecimal get() = BigDecimal(converted)

    /** Whether the headline figure is the whole answer. */
    val isWholeAnswer: Boolean get() = complete
}

@Serializable
data class MethodTotals(
    val method: PaymentMethod,
    val totals: Totals,
)

@Serializable
data class CollectionReport(
    val from: String,
    val to: String,
    val currency: Currency,
    val received: Totals,
    val refunded: Totals,
    /** Received less refunded. */
    val net: Totals,
    val byMethod: List<MethodTotals> = emptyList(),
    val paymentCount: Int = 0,
)

@Serializable
data class AgeingBucket(
    val bucket: String,
    val totals: Totals,
    val recordCount: Int = 0,
) {
    val stringKey: String get() = "finance.ageing.$bucket"
}

@Serializable
data class OutstandingReport(
    val currency: Currency,
    val outstanding: Totals,
    val ageing: List<AgeingBucket> = emptyList(),
    val recordCount: Int = 0,
)

@Serializable
data class FinanceRecordPage(
    val items: List<FinanceRecord> = emptyList(),
    val nextCursor: String? = null,
)

@Serializable
private data class RecordPaymentBody(
    val amount: String,
    val currency: Currency? = null,
    val appliedAmount: String? = null,
    val method: PaymentMethod,
    val paidAt: String? = null,
    val reference: String? = null,
)

/** A rate the clinic recorded for one day. */
@Serializable
data class ExchangeRate(
    val base: Currency,
    val quote: Currency,
    /**
     * Decimal on the wire: a binary float cannot hold 35.42 exactly, and this
     * is a number invoices are built from.
     */
    val rate: String,
    /** `2026-09-12`. */
    val validOn: String,
) {
    val value: BigDecimal get() = BigDecimal(rate)
}

/**
 * An agency that sends the clinic patients, and what it is owed.
 *
 * `commissionRate` is a decimal string for the reason every other money field
 * is: a binary float cannot hold 0.1 exactly, and this one multiplies an
 * invoice.
 */
@Serializable
data class Agency(
    val id: String,
    val name: String,
    val country: String? = null,
    val contactName: String? = null,
    val contactEmail: String? = null,
    val contactPhone: String? = null,
    /** Fraction of the net, 0–1. Null when none was agreed. */
    val commissionRate: String? = null,
    val isActive: Boolean = true,
) {
    /** The rate as a whole-number percentage, or null when there is none. */
    val commissionPercent: Int?
        get() = commissionRate?.let { BigDecimal(it).multiply(BigDecimal(100)).toInt() }
}

@Serializable
data class NewAgency(
    val name: String,
    val country: String? = null,
    val contactName: String? = null,
    val contactEmail: String? = null,
    val contactPhone: String? = null,
    val commissionRate: String? = null,
)

/**
 * Changing an agency. Every field is optional; omitting one leaves it.
 *
 * `isActive` is why this is not the same shape as [NewAgency]: switching an
 * agency off is the ordinary edit, and deleting one would leave the invoices
 * carrying its commission naming nothing.
 */
@Serializable
data class AgencyEdit(
    val name: String? = null,
    val country: String? = null,
    val contactName: String? = null,
    val contactEmail: String? = null,
    val contactPhone: String? = null,
    val commissionRate: String? = null,
    val isActive: Boolean? = null,
)

@Serializable
private data class FinanceReasonBody(val reason: String)

class FinanceApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    suspend fun records(
        status: PaymentStatus? = null,
        /**
         * What to convert the totals into.
         *
         * The ledger holds amounts in the currency each was billed in, and the
         * server converts for the reader. Without it the screen's picker moved
         * the reports and left the list in whatever it was billed in, so two
         * halves of one screen quoted two currencies.
         */
        currency: Currency? = null,
        cursor: String? = null,
    ): FinanceRecordPage {
        val query = buildList {
            status?.let { add("status=${it.name}") }
            currency?.let { add("currency=${it.name}") }
            cursor?.let { add("cursor=$it") }
        }.joinToString("&")

        val path = if (query.isEmpty()) "finance/records" else "finance/records?$query"
        return decode(client.send(Endpoint(HttpMethod.GET, path)))
    }

    suspend fun record(id: String): FinanceRecord =
        decode(client.send(Endpoint(HttpMethod.GET, "finance/records/$id")))

    suspend fun forPatient(patientId: String): List<FinanceRecord> =
        decode(client.send(Endpoint(HttpMethod.GET, "patients/$patientId/finance")))

    /** Recording money that arrived. Amounts go up as strings too. */
    suspend fun recordPayment(
        recordId: String,
        amount: String,
        method: PaymentMethod,
        currency: Currency? = null,
        appliedAmount: String? = null,
        paidAt: String? = null,
        reference: String? = null,
    ): FinanceRecord =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "finance/records/$recordId/payments",
                    body = json.encodeToString(
                        RecordPaymentBody.serializer(),
                        RecordPaymentBody(amount, currency, appliedAmount, method, paidAt, reference),
                    ),
                ),
            ),
        )

    suspend fun reversePayment(paymentId: String, reason: String): FinanceRecord =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "finance/payments/$paymentId/reverse",
                    body = json.encodeToString(
                        FinanceReasonBody.serializer(),
                        FinanceReasonBody(reason),
                    ),
                ),
            ),
        )

    suspend fun collections(from: String, to: String, currency: Currency = Currency.TRY): CollectionReport =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.GET,
                    "finance/collections?from=$from&to=$to&currency=${currency.name}",
                ),
            ),
        )

    /** Who sends the clinic patients, and on what commission. */
    suspend fun agencies(): List<Agency> =
        decode(client.send(Endpoint(HttpMethod.GET, "finance/agencies")))

    suspend fun addAgency(agency: NewAgency): Agency =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "finance/agencies",
                    body = json.encodeToString(NewAgency.serializer(), agency),
                ),
            ),
        )

    /**
     * Changes an agency. Every field is optional; omitting one leaves it.
     *
     * Which is what makes "switch this one off" a different action from
     * "rewrite this one": an agency that stopped sending patients still has
     * invoices with its commission on them, and deleting it would leave those
     * naming nothing.
     */
    suspend fun updateAgency(id: String, change: AgencyEdit): Agency =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.PATCH,
                    "finance/agencies/$id",
                    body = json.encodeToString(AgencyEdit.serializer(), change),
                ),
            ),
        )

    /**
     * The rates the server used, for the window a report covers.
     *
     * Read alongside the totals rather than on its own: a total marked
     * incomplete is incomplete because a day in the window had no rate, and
     * this is the list that says which.
     */
    suspend fun rates(from: String, to: String): List<ExchangeRate> =
        decode(client.send(Endpoint(HttpMethod.GET, "finance/rates?from=$from&to=$to")))

    suspend fun outstanding(currency: Currency = Currency.TRY): OutstandingReport =
        decode(client.send(Endpoint(HttpMethod.GET, "finance/outstanding?currency=${currency.name}")))

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
