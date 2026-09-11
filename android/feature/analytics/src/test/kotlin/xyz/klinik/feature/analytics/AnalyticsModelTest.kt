package xyz.klinik.feature.analytics

import java.time.Instant
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.AnalyticsApi
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object AnalyticsRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading a report must not refresh a session")
}

private class AnalyticsTransport(private val statuses: Map<String, Pair<Int, String>>) :
    HttpTransport {
    val urls = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        urls += path

        val (status, body) = statuses[path.substringBefore("?")] ?: (200 to "{}")

        return HttpResponse(status, body)
    }
}

private const val PROCEDURES = """
    {"from":"2026-01-01","to":"2026-09-12","total":40,
     "byMonth":[{"month":"2026-03","count":12}],
     "byProcedure":[{"label":"Rinoplasti","count":22,"share":0.55}]}
"""

private const val GEOGRAPHY = """
    {"from":"2026-01-01","to":"2026-09-12","total":40,
     "byCountry":[{"label":"Almanya","count":18,"share":0.45}],
     "byCity":[],"cityUnknown":3}
"""

private const val OCCUPANCY = """
    {"from":"2026-01-01","to":"2026-09-12","byMonth":[],"capacityUnconfigured":true}
"""

/**
 * The clinic's numbers (spec M11).
 *
 * Two behaviours matter more than the arithmetic, which is the server's. A
 * doctor without `finance.read` still gets the panel — just not the money in
 * it. And "this year" has to mean the clinic's year, ending now rather than at
 * the end of December, or a report about what happened contains bookings that
 * have not.
 */
class AnalyticsModelTest {
    private val istanbul = ZoneId.of("Europe/Istanbul")

    private suspend fun model(
        transport: AnalyticsTransport,
        now: String = "2026-09-12T09:30:00Z",
    ): AnalyticsModel {
        val session = SessionManager(InMemoryTokenStore(), AnalyticsRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return AnalyticsModel(
            AnalyticsApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
            clock = { Instant.parse(now) },
            zone = istanbul,
        )
    }

    /**
     * A section refused is a section missing, not a panel that failed.
     *
     * Revenue and channels need `finance.read`; a surgeon may not hold it and
     * is still entitled to see how many operations they did.
     */
    @Test
    fun `a forbidden section leaves the rest of the panel alone`() = runTest {
        val subject = model(
            AnalyticsTransport(
                mapOf(
                    "analytics/procedures" to (200 to PROCEDURES),
                    "analytics/geography" to (200 to GEOGRAPHY),
                    "analytics/occupancy" to (200 to OCCUPANCY),
                    "analytics/revenue" to (403 to """{"message":"forbidden"}"""),
                    "analytics/channels" to (403 to """{"message":"forbidden"}"""),
                ),
            ),
        )

        subject.load()

        val state = subject.state.value

        assertEquals(AnalyticsPhase.Loaded, state.phase)
        assertEquals(40, state.procedures?.total)
        assertNotNull(state.geography)
        assertNull(state.revenue)
        assertNull(state.channels)
    }

    /**
     * Nothing at all is a permission answer, not an empty clinic — and the two
     * read very differently to somebody who has just opened the panel.
     */
    @Test
    fun `no section at all means the account cannot see the panel`() = runTest {
        val subject = model(
            AnalyticsTransport(
                listOf("procedures", "geography", "occupancy", "revenue", "channels")
                    .associate { "analytics/$it" to (403 to """{"message":"forbidden"}""") },
            ),
        )

        subject.load()

        assertEquals(AnalyticsPhase.NotPermitted, subject.state.value.phase)
    }

    /**
     * "This year" ends now.
     *
     * Running it to the end of December would put bookings that have not
     * happened into a report about what has.
     */
    @Test
    fun `this year runs from January to this moment`() = runTest {
        val transport = AnalyticsTransport(mapOf("analytics/procedures" to (200 to PROCEDURES)))
        val subject = model(transport)

        subject.choose(ReportRange.THIS_YEAR)

        val url = transport.urls.first { it.startsWith("analytics/procedures") }

        // Istanbul is UTC+3, so the local first of January is 21:00 on the
        // thirty-first in UTC.
        assertTrue("from=2025-12-31T21:00:00Z" in url, url)
        assertTrue("to=2026-09-12T09:30:00Z" in url, url)
    }

    /** Last year is a closed period; running it to today would mix two. */
    @Test
    fun `last year stops where this year starts`() = runTest {
        val transport = AnalyticsTransport(mapOf("analytics/procedures" to (200 to PROCEDURES)))
        val subject = model(transport)

        subject.choose(ReportRange.LAST_YEAR)

        val url = transport.urls.first { it.startsWith("analytics/procedures") }

        assertTrue("from=2024-12-31T21:00:00Z" in url, url)
        assertTrue("to=2025-12-31T20:59:59Z" in url, url)
    }

    @Test
    fun `this month starts on the first`() = runTest {
        val transport = AnalyticsTransport(mapOf("analytics/procedures" to (200 to PROCEDURES)))
        val subject = model(transport)

        subject.choose(ReportRange.THIS_MONTH)

        val url = transport.urls.first { it.startsWith("analytics/procedures") }

        assertTrue("from=2026-08-31T21:00:00Z" in url, url)
    }

    /** The chosen currency reaches the two reports that carry money. */
    @Test
    fun `the currency is asked for where money is reported`() = runTest {
        val transport = AnalyticsTransport(mapOf("analytics/procedures" to (200 to PROCEDURES)))
        val subject = model(transport)

        subject.choose(xyz.klinik.network.Currency.EUR)

        assertTrue(transport.urls.any { it.startsWith("analytics/revenue") && "currency=EUR" in it })
        assertTrue(transport.urls.any { it.startsWith("analytics/channels") && "currency=EUR" in it })
        assertTrue(transport.urls.none { it.startsWith("analytics/geography") && "currency" in it })
    }
}
