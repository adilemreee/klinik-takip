package xyz.klinik.feature.analytics

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.AnalyticsApi
import xyz.klinik.network.ChannelReport
import xyz.klinik.network.Currency
import xyz.klinik.network.GeographyReport
import xyz.klinik.network.OccupancyReport
import xyz.klinik.network.ProcedureReport
import xyz.klinik.network.RevenueReport

/** The ranges a clinic actually asks for. */
enum class ReportRange {
    THIS_MONTH,
    LAST_THREE_MONTHS,
    THIS_YEAR,
    LAST_YEAR,
    ;

    val stringKey: String
        get() = "analytics.range." + when (this) {
            THIS_MONTH -> "thisMonth"
            LAST_THREE_MONTHS -> "lastThreeMonths"
            THIS_YEAR -> "thisYear"
            LAST_YEAR -> "lastYear"
        }

    /**
     * The window, as the API wants it.
     *
     * Ends at "now" rather than at the end of the period, so a report about
     * what has happened does not include tomorrow's bookings. The zone is the
     * device's: a clinic asking for "this month" means its own month.
     */
    fun bounds(now: Instant, zone: ZoneId): Pair<String, String> {
        val moment = ZonedDateTime.ofInstant(now, zone)

        val from = when (this) {
            THIS_MONTH -> moment.withDayOfMonth(1).toLocalDate().atStartOfDay(zone)
            LAST_THREE_MONTHS -> moment.minusMonths(3).toLocalDate().atStartOfDay(zone)
            THIS_YEAR -> moment.withDayOfYear(1).toLocalDate().atStartOfDay(zone)
            LAST_YEAR -> moment.withDayOfYear(1).minusYears(1).toLocalDate().atStartOfDay(zone)
        }

        val to = when (this) {
            // Up to the instant this year began, not to today: last year is a
            // closed period, and running it to now would mix two.
            LAST_YEAR -> moment.withDayOfYear(1).toLocalDate().atStartOfDay(zone).minusSeconds(1)
            else -> moment
        }

        return from.toInstant().toString() to to.toInstant().toString()
    }
}

sealed interface AnalyticsPhase {
    data object Loading : AnalyticsPhase
    data object Loaded : AnalyticsPhase

    /** Not a failure: an account without `analytics.read` simply has no panel. */
    data object NotPermitted : AnalyticsPhase
}

data class AnalyticsState(
    val phase: AnalyticsPhase = AnalyticsPhase.Loading,
    val range: ReportRange = ReportRange.THIS_YEAR,
    val currency: Currency = Currency.TRY,
    val procedures: ProcedureReport? = null,
    val geography: GeographyReport? = null,
    val revenue: RevenueReport? = null,
    val channels: ChannelReport? = null,
    val occupancy: OccupancyReport? = null,
)

/**
 * The clinic's numbers (spec M11).
 *
 * Five reports, fetched together because they are one screen and a panel that
 * fills in over five seconds is a panel somebody screenshots half-drawn.
 *
 * Each one is allowed to be missing on its own. Revenue and channels need
 * `finance.read`, which a doctor may not hold while still being allowed to see
 * how many operations they did — so one section answering 403 leaves the rest
 * of the panel alone rather than replacing it with an error.
 */
class AnalyticsModel(
    private val api: AnalyticsApi,
    private val clock: () -> Instant = Instant::now,
    private val zone: ZoneId = ZoneId.systemDefault(),
) {
    private val _state = MutableStateFlow(AnalyticsState())
    val state: StateFlow<AnalyticsState> = _state.asStateFlow()

    suspend fun choose(range: ReportRange) {
        _state.value = _state.value.copy(range = range)
        load()
    }

    suspend fun choose(currency: Currency) {
        _state.value = _state.value.copy(currency = currency)
        load()
    }

    suspend fun load() = coroutineScope {
        val current = _state.value

        _state.value = current.copy(phase = AnalyticsPhase.Loading)

        val (from, to) = current.range.bounds(clock(), zone)

        val procedures = async { optional { api.procedures(from, to) } }
        val geography = async { optional { api.geography(from, to) } }
        val revenue = async { optional { api.revenue(from, to, current.currency) } }
        val channels = async { optional { api.channels(from, to, current.currency) } }
        val occupancy = async { optional { api.occupancy(from, to) } }

        val loaded = listOf(procedures, geography, revenue, channels, occupancy).map { it.await() }

        _state.value = current.copy(
            // Nothing at all came back: this account cannot see the panel,
            // which is a different thing from an empty clinic and reads
            // differently.
            phase = if (loaded.all { it == null }) {
                AnalyticsPhase.NotPermitted
            } else {
                AnalyticsPhase.Loaded
            },
            procedures = loaded[0] as ProcedureReport?,
            geography = loaded[1] as GeographyReport?,
            revenue = loaded[2] as RevenueReport?,
            channels = loaded[3] as ChannelReport?,
            occupancy = loaded[4] as OccupancyReport?,
        )
    }

    private suspend fun <T> optional(work: suspend () -> T): T? =
        runCatching { work() }.getOrNull()
}
