package xyz.klinik.feature.appointments

import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.AppointmentsApi
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object CalendarRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading the calendar must not refresh a session")
}

private class CalendarTransport(private val status: Int, private val body: String) : HttpTransport {
    val urls = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        urls += request.url.substringAfter("https://api.test/")

        return HttpResponse(status, body)
    }
}

private fun appointment(id: String, at: String, status: String = "CONFIRMED") = """
    {"id":"$id","patientId":"p1","staffId":"s1","type":"CONTROL","status":"$status",
     "scheduledAt":"$at","durationMinutes":30,"location":null,"note":null,
     "cancelledAt":null,"cancelledReason":null,"remindersSent":[]}
""".trimIndent()

/**
 * The clinic's month (spec M3).
 *
 * The window and what is drawn on it are the whole risk: a bound that drops
 * the last evening, or a cancelled appointment still occupying a slot, both
 * make a clinician read a day wrongly.
 */
class CalendarModelTest {
    private val istanbul = ZoneId.of("Europe/Istanbul")

    private suspend fun model(
        transport: CalendarTransport,
        today: LocalDate = LocalDate.of(2026, 9, 12),
    ): CalendarModel {
        val session = SessionManager(InMemoryTokenStore(), CalendarRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return CalendarModel(
            AppointmentsApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
            zone = istanbul,
            today = { today },
        )
    }

    /**
     * The whole month, in the clinic's zone.
     *
     * Istanbul is UTC+3, so the first of September begins at 21:00 on the
     * thirty-first of August in UTC — and the bound runs to the first instant
     * of October, so an appointment at 23:30 on the thirtieth is inside it.
     */
    @Test
    fun `the window covers the month in the clinic's own zone`() = runTest {
        val transport = CalendarTransport(200, "[]")
        val subject = model(transport)

        subject.load(YearMonth.of(2026, 9))

        // Decoded, because the client percent-encodes the colons in an
        // instant and the assertion is about the instant, not the encoding.
        val url = java.net.URLDecoder.decode(transport.urls.single(), "UTF-8")

        assertTrue("from=2026-08-31T21:00:00Z" in url, url)
        assertTrue("to=2026-09-30T21:00:00Z" in url, url)
    }

    /**
     * A cancelled appointment is not on the calendar.
     *
     * The slot is free, and a grid still showing it has a clinician reading a
     * full day that is not.
     */
    @Test
    fun `a cancelled appointment leaves the day`() = runTest {
        val subject = model(
            CalendarTransport(
                200,
                "[" + listOf(
                    appointment("a", "2026-09-15T09:00:00.000Z"),
                    appointment("b", "2026-09-15T10:00:00.000Z", status = "CANCELLED"),
                ).joinToString(",") + "]",
            ),
        )

        subject.load(YearMonth.of(2026, 9))

        val day = LocalDate.of(2026, 9, 15)

        assertEquals(listOf("a"), subject.state.value.byDay(istanbul)[day]?.map { it.id })
    }

    /** Today is the day somebody is most likely to want. */
    @Test
    fun `this month opens on today`() = runTest {
        val subject = model(CalendarTransport(200, "[]"))

        subject.load(YearMonth.of(2026, 9))

        assertEquals(LocalDate.of(2026, 9, 12), subject.state.value.selected)
    }

    /** Another month opens on its first day, because today is not in it. */
    @Test
    fun `another month opens on the first`() = runTest {
        val subject = model(CalendarTransport(200, "[]"))

        subject.load(YearMonth.of(2026, 11))

        assertEquals(LocalDate.of(2026, 11, 1), subject.state.value.selected)
    }

    /** A day with something still waiting on the clinic is marked. */
    @Test
    fun `days with a request are marked`() = runTest {
        val subject = model(
            CalendarTransport(
                200,
                "[" + listOf(
                    appointment("a", "2026-09-15T09:00:00.000Z"),
                    appointment("b", "2026-09-18T09:00:00.000Z", status = "REQUESTED"),
                ).joinToString(",") + "]",
            ),
        )

        subject.load(YearMonth.of(2026, 9))

        assertEquals(
            setOf(LocalDate.of(2026, 9, 18)),
            subject.state.value.awaitingConfirmation(istanbul),
        )
    }

    /** The day's own list is in time order, whatever the server sent. */
    @Test
    fun `the chosen day lists its appointments in order`() = runTest {
        val subject = model(
            CalendarTransport(
                200,
                "[" + listOf(
                    appointment("late", "2026-09-15T14:00:00.000Z"),
                    appointment("early", "2026-09-15T09:00:00.000Z"),
                ).joinToString(",") + "]",
            ),
        )

        subject.load(YearMonth.of(2026, 9))
        subject.select(LocalDate.of(2026, 9, 15))

        assertEquals(
            listOf("early", "late"),
            subject.state.value.forSelected(istanbul).map { it.id },
        )
    }

    @Test
    fun `a forbidden account is told so rather than shown an error`() = runTest {
        val subject = model(CalendarTransport(403, """{"message":"forbidden"}"""))

        subject.load(YearMonth.of(2026, 9))

        assertEquals(CalendarPhase.NotPermitted, subject.state.value.phase)
    }
}
