package xyz.klinik.network

import java.math.BigDecimal
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

/**
 * The clinic dashboard (spec M11, T6.4).
 *
 * Almost all of this is about one thing: a missing proportion must never reach
 * the screen as a number. "Not enough data" and "nought per cent" are different
 * statements, and only one of them is true.
 */
class AnalyticsApiTest {
    @Test
    fun `a missing proportion has no percentage at all`() {
        val unknown = Proportion(null)

        assertFalse(unknown.isKnown)
        assertNull(unknown.percent)
    }

    @Test
    fun `a known proportion is a percentage`() {
        assertEquals(40, Proportion(0.4).percent)
        assertEquals(0, Proportion(0.0).percent)
    }

    @Test
    fun `reads procedures with the quiet months still in them`() {
        val report = json.decodeFromString<ProcedureReport>(
            """
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-04-30T00:00:00.000Z","total":3,
             "byMonth":[{"month":"2026-01","count":0},{"month":"2026-02","count":2},
                        {"month":"2026-03","count":0},{"month":"2026-04","count":1}],
             "byProcedure":[{"label":"Rinoplasti","count":2,"share":null}]}
            """.trimIndent(),
        )

        assertEquals(4, report.byMonth.size)
        assertEquals("2026-02", report.busiestMonth?.month)
        // Two of three is not "67%" worth stating.
        assertFalse(report.byProcedure[0].proportion.isKnown)
    }

    @Test
    fun `geography keeps the patients with no city`() {
        val report = json.decodeFromString<GeographyReport>(
            """
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-12-31T00:00:00.000Z","total":10,
             "byCountry":[{"label":"DE","count":6,"share":0.6}],
             "byCity":[{"label":"Berlin","count":5,"share":0.5}],
             "cityUnknown":5}
            """.trimIndent(),
        )

        assertEquals(5, report.cityUnknown)
        assertEquals(60, report.byCountry[0].proportion.percent)
    }

    /** An empty revenue column is not evidence that a channel earned nothing. */
    @Test
    fun `says why the revenue column is empty`() {
        val withheld = json.decodeFromString<ChannelReport>(
            """
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-12-31T00:00:00.000Z","total":40,
             "channels":[{"label":"Instagram","key":"instagram","patients":30,"converted":9,
                          "conversionRate":0.3}],
             "revenueWithheld":true,
             "conversionDefinition":"at least one recorded operation","minimumForRate":5}
            """.trimIndent(),
        )

        assertNull(withheld.channels[0].revenue)
        assertEquals("analytics_revenue_withheld", withheld.revenueNoticeKey)
        assertEquals(30, withheld.channels[0].conversion.percent)
    }

    @Test
    fun `carries the definition of conversion`() {
        val report = json.decodeFromString<ChannelReport>(
            """
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-12-31T00:00:00.000Z","total":3,
             "channels":[{"label":"Google","key":"google","patients":3,"converted":3,
                          "conversionRate":null}],
             "revenueWithheld":false,
             "conversionDefinition":"at least one recorded operation","minimumForRate":5}
            """.trimIndent(),
        )

        // Three of three is not a hundred per cent conversion rate.
        assertFalse(report.channels[0].conversion.isKnown)
        assertNull(report.revenueNoticeKey)
        assertTrue(report.conversionDefinition.isNotEmpty())
    }

    @Test
    fun `revenue says when the margin is missing something`() {
        val report = json.decodeFromString<RevenueReport>(
            """
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-12-31T00:00:00.000Z","currency":"TRY",
             "gross":{"currency":"TRY","converted":"100000.00","complete":true},
             "discount":{"currency":"TRY","converted":"0.00","complete":true},
             "net":{"currency":"TRY","converted":"100000.00","complete":true},
             "cost":{"currency":"TRY","converted":"40000.00","complete":true},
             "agencyCommission":{"currency":"TRY","converted":"10000.00","complete":true},
             "margin":{"currency":"TRY","converted":"50000.00","complete":true},
             "byMonth":[{"month":"2026-01","net":"100000.00","converted":true}],
             "averageByCurrency":[{"currency":"EUR","average":"4000.00","count":12}],
             "recordCount":12,"cancelledExcluded":1,"unreadableCostLines":3}
            """.trimIndent(),
        )

        assertFalse(report.marginIsWhole)
        assertTrue(report.caveatKeys.contains("analytics_cost_lines_unread"))
        assertEquals(0, report.averageByCurrency[0].value.compareTo(BigDecimal("4000.00")))
    }

    @Test
    fun `an incomplete net adds its own caveat`() {
        val report = json.decodeFromString<RevenueReport>(
            """
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-12-31T00:00:00.000Z","currency":"TRY",
             "gross":{"currency":"TRY","converted":"0.00","complete":false},
             "discount":{"currency":"TRY","converted":"0.00","complete":true},
             "net":{"currency":"TRY","converted":"0.00",
                    "unconverted":[{"currency":"GBP","amount":"2000.00"}],"complete":false},
             "cost":{"currency":"TRY","converted":"0.00","complete":true},
             "agencyCommission":{"currency":"TRY","converted":"0.00","complete":true},
             "margin":{"currency":"TRY","converted":"0.00","complete":false},
             "byMonth":[{"month":"2026-01","net":"0.00","converted":false}],
             "recordCount":1,"cancelledExcluded":0,"unreadableCostLines":0}
            """.trimIndent(),
        )

        assertTrue(report.caveatKeys.contains("finance_totals_incomplete"))
        assertFalse(report.marginIsWhole)
        // So a chart can mark the month rather than draw a dip that never happened.
        assertFalse(report.byMonth[0].converted)
        assertEquals(Currency.GBP, report.net.unconverted[0].currency)
    }

    @Test
    fun `occupancy says when there is no denominator`() {
        val report = json.decodeFromString<OccupancyReport>(
            """
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-01-31T00:00:00.000Z",
             "byMonth":[{"month":"2026-01","bookedMinutes":600,"availableMinutes":0,
                         "rate":null,"appointments":8}],
             "capacityUnconfigured":true}
            """.trimIndent(),
        )

        // Nought per cent would read as an empty diary; this is a missing setting.
        assertFalse(report.byMonth[0].occupancy.isKnown)
        assertEquals("analytics_capacity_unconfigured", report.noticeKey)
        assertEquals(600, report.byMonth[0].bookedMinutes)
    }

    @Test
    fun `occupancy has a rate once hours are configured`() {
        val report = json.decodeFromString<OccupancyReport>(
            """
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-01-31T00:00:00.000Z",
             "byMonth":[{"month":"2026-01","bookedMinutes":240,"availableMinutes":480,
                         "rate":0.5,"appointments":4}],
             "capacityUnconfigured":false}
            """.trimIndent(),
        )

        assertEquals(50, report.byMonth[0].occupancy.percent)
        assertNull(report.noticeKey)
    }
}
