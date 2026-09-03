package xyz.klinik.network

import java.math.BigDecimal
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The clinic dashboard (spec M11, T6.4).
 *
 * The types here exist mostly to stop one mistake: rendering "not enough to
 * say" as a number. A share, a conversion rate and an occupancy rate are all
 * nullable, and each is null for a reason the reader has to be told — too few
 * cases, or no working hours configured. Showing 0% instead would be a
 * confident claim the data does not support.
 */

/** A proportion that may not exist yet. */
@JvmInline
value class Proportion(val value: Double?) {
    val isKnown: Boolean get() = value != null

    /** The percentage, or null for the caller to replace with a reason. */
    val percent: Int? get() = value?.let { Math.round(it * 100).toInt() }
}

@Serializable
data class NamedCount(
    /** The clinic's own spelling. */
    val label: String,
    val count: Int = 0,
    /** Null when there are too few cases to state a proportion. */
    val share: Double? = null,
) {
    val proportion: Proportion get() = Proportion(share)
}

@Serializable
data class MonthlyCount(
    /** `2026-03`. */
    val month: String,
    val count: Int = 0,
)

@Serializable
data class ProcedureReport(
    val from: String,
    val to: String,
    val total: Int = 0,
    /** Every month in range, empty ones included. */
    val byMonth: List<MonthlyCount> = emptyList(),
    val byProcedure: List<NamedCount> = emptyList(),
) {
    val busiestMonth: MonthlyCount? get() = byMonth.maxByOrNull { it.count }
}

@Serializable
data class GeographyReport(
    val from: String,
    val to: String,
    val total: Int = 0,
    val byCountry: List<NamedCount> = emptyList(),
    val byCity: List<NamedCount> = emptyList(),
    /** Patients with no city recorded, so the shares add up. */
    val cityUnknown: Int = 0,
)

@Serializable
data class ChannelRow(
    val label: String,
    val key: String,
    val patients: Int = 0,
    val converted: Int = 0,
    val conversionRate: Double? = null,
    /** Absent when the viewer may not see money. */
    val revenue: Totals? = null,
) {
    val conversion: Proportion get() = Proportion(conversionRate)
}

@Serializable
data class ChannelReport(
    val from: String,
    val to: String,
    val total: Int = 0,
    val channels: List<ChannelRow> = emptyList(),
    /**
     * True when the viewer may not see money.
     *
     * The screen must say this. An empty revenue column otherwise reads as
     * "this channel earned nothing", which is a different and much worse claim
     * than "you are not allowed to see it".
     */
    val revenueWithheld: Boolean = false,
    /** What "converted" means, so two readers cannot mean two things. */
    val conversionDefinition: String = "",
    val minimumForRate: Int = 0,
) {
    val revenueNoticeKey: String? get() = if (revenueWithheld) "analytics_revenue_withheld" else null
}

@Serializable
data class MonthlyNet(
    val month: String,
    val net: String,
    /** False when this month had amounts with no exchange rate. */
    val converted: Boolean = true,
) {
    val value: BigDecimal get() = BigDecimal(net)
}

@Serializable
data class CurrencyAverage(
    val currency: Currency,
    val average: String,
    val count: Int = 0,
) {
    val value: BigDecimal get() = BigDecimal(average)
}

@Serializable
data class RevenueReport(
    val from: String,
    val to: String,
    val currency: Currency,
    val gross: Totals,
    val discount: Totals,
    val net: Totals,
    val cost: Totals,
    val agencyCommission: Totals,
    /** Net less costs and commission. */
    val margin: Totals,
    val byMonth: List<MonthlyNet> = emptyList(),
    /** Exact, per currency. An average blended across currencies is a fiction. */
    val averageByCurrency: List<CurrencyAverage> = emptyList(),
    val recordCount: Int = 0,
    val cancelledExcluded: Int = 0,
    /** Non-zero means the margin is missing something. */
    val unreadableCostLines: Int = 0,
) {
    /** Whether the margin can be shown without a caveat beside it. */
    val marginIsWhole: Boolean get() = unreadableCostLines == 0 && margin.complete

    val caveatKeys: List<String>
        get() = buildList {
            if (unreadableCostLines > 0) add("analytics_cost_lines_unread")
            if (!net.complete) add("finance_totals_incomplete")
        }
}

@Serializable
data class MonthlyOccupancy(
    val month: String,
    val bookedMinutes: Int = 0,
    val availableMinutes: Int = 0,
    /** Null when no working hours are configured — not zero. */
    val rate: Double? = null,
    val appointments: Int = 0,
) {
    val occupancy: Proportion get() = Proportion(rate)
}

@Serializable
data class OccupancyReport(
    val from: String,
    val to: String,
    val byMonth: List<MonthlyOccupancy> = emptyList(),
    /** True when no availability window exists at all. */
    val capacityUnconfigured: Boolean = false,
) {
    /** What to put on the screen instead of a chart nobody can read. */
    val noticeKey: String?
        get() = if (capacityUnconfigured) "analytics_capacity_unconfigured" else null
}

class AnalyticsApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    suspend fun procedures(from: String, to: String): ProcedureReport =
        decode(client.send(Endpoint(HttpMethod.GET, "analytics/procedures?${range(from, to)}")))

    suspend fun geography(from: String, to: String): GeographyReport =
        decode(client.send(Endpoint(HttpMethod.GET, "analytics/geography?${range(from, to)}")))

    suspend fun channels(from: String, to: String, currency: Currency = Currency.TRY): ChannelReport =
        decode(
            client.send(
                Endpoint(HttpMethod.GET, "analytics/channels?${range(from, to)}&currency=${currency.name}"),
            ),
        )

    suspend fun revenue(from: String, to: String, currency: Currency = Currency.TRY): RevenueReport =
        decode(
            client.send(
                Endpoint(HttpMethod.GET, "analytics/revenue?${range(from, to)}&currency=${currency.name}"),
            ),
        )

    suspend fun occupancy(from: String, to: String): OccupancyReport =
        decode(client.send(Endpoint(HttpMethod.GET, "analytics/occupancy?${range(from, to)}")))

    private fun range(from: String, to: String): String = "from=$from&to=$to"

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
