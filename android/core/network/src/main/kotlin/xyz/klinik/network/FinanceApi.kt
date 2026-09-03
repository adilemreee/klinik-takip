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

    val stringKey: String get() = "finance_status_${name.lowercase()}"

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

    val stringKey: String get() = "finance_method_${name.lowercase()}"
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
    val stringKey: String get() = "finance_ageing_$bucket"
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

@Serializable
private data class FinanceReasonBody(val reason: String)

class FinanceApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    suspend fun records(status: PaymentStatus? = null, cursor: String? = null): FinanceRecordPage {
        val query = buildList {
            status?.let { add("status=${it.name}") }
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

    suspend fun outstanding(currency: Currency = Currency.TRY): OutstandingReport =
        decode(client.send(Endpoint(HttpMethod.GET, "finance/outstanding?currency=${currency.name}")))

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
