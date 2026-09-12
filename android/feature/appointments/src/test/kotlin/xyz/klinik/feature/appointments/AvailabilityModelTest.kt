package xyz.klinik.feature.appointments

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
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

private object AvailabilityRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading working hours must not refresh a session")
}

private class AvailabilityTransport(private val bodies: Map<String, Pair<Int, String>>) :
    HttpTransport {
    val sent = mutableListOf<Pair<String, String>>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        sent += "${request.method} $path" to request.body.orEmpty()

        val (status, body) = bodies["${request.method} $path"] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private fun window(
    id: String,
    day: Int,
    from: String = "09:00",
    to: String = "17:00",
    active: Boolean = true,
) = """
    {"id":"$id","staffId":"s1","dayOfWeek":$day,"startTime":"$from","endTime":"$to",
     "timezone":"Europe/Istanbul","isActive":$active}
""".trimIndent()

/**
 * When a clinician can be booked (spec M3).
 *
 * The distinction worth holding to is off versus removed: one is a week away
 * and the other loses the pattern, and neither cancels an appointment already
 * in the diary.
 */
class AvailabilityModelTest {
    private suspend fun model(transport: AvailabilityTransport): AvailabilityModel {
        val session = SessionManager(InMemoryTokenStore(), AvailabilityRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return AvailabilityModel(
            AppointmentsApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
            timezone = "Europe/Istanbul",
        )
    }

    /**
     * No hours published is not a free calendar.
     *
     * The system does not offer appointments with a clinician who has none, so
     * the empty list means nobody can book them at all.
     */
    @Test
    fun `no windows is its own state`() = runTest {
        val subject = model(
            AvailabilityTransport(mapOf("GET appointments/availability" to (200 to "[]"))),
        )

        subject.load()

        assertEquals(AvailabilityPhase.None, subject.state.value.phase)
    }

    /** A login with no staff record is told that, not shown an error. */
    @Test
    fun `an account with no staff profile is told so`() = runTest {
        val subject = model(
            AvailabilityTransport(
                mapOf("GET appointments/availability" to (404 to """{"message":"not found"}""")),
            ),
        )

        subject.load()

        assertEquals(AvailabilityPhase.NoProfile, subject.state.value.phase)
    }

    /** Monday first, Sunday last — the week as a person reads it. */
    @Test
    fun `the week starts on Monday`() = runTest {
        val subject = model(
            AvailabilityTransport(
                mapOf(
                    "GET appointments/availability" to (
                        200 to "[${window("a", 0)},${window("b", 3)},${window("c", 1)}]"
                        ),
                ),
            ),
        )

        subject.load()

        assertEquals(listOf(1, 3, 0), subject.state.value.byDay.map { it.first })
    }

    /** A window ending before it starts never leaves the phone. */
    @Test
    fun `an end before the start is refused here`() = runTest {
        val transport = AvailabilityTransport(
            mapOf("GET appointments/availability" to (200 to "[]")),
        )
        val subject = model(transport)

        subject.load()

        assertEquals(WindowProblem.EndBeforeStart, subject.check("17:00", "09:00"))
        assertFalse(subject.add(1, "17:00", "09:00"))
        assertTrue(transport.sent.none { it.first.startsWith("POST") })
        assertNotNull(subject.state.value.error)
    }

    /** The clinician's own zone travels with the window. */
    @Test
    fun `a new window carries the timezone`() = runTest {
        val transport = AvailabilityTransport(
            mapOf(
                "GET appointments/availability" to (200 to "[]"),
                "POST appointments/availability" to (200 to window("new", 1)),
            ),
        )
        val subject = model(transport)

        subject.load()

        assertTrue(subject.add(1, "09:00", "17:00"))
        assertTrue(
            "Europe/Istanbul" in transport.sent.last { it.first.startsWith("POST") }.second,
        )
        assertEquals(AvailabilityPhase.Loaded, subject.state.value.phase)
    }

    /**
     * Switching off keeps the row, so it can come back on.
     *
     * And the state comes from the server: a switch flipped locally would show
     * hours as published that nobody can book.
     */
    @Test
    fun `switching a window off keeps the pattern`() = runTest {
        val subject = model(
            AvailabilityTransport(
                mapOf(
                    "GET appointments/availability" to (200 to "[${window("a", 1)}]"),
                    "PATCH appointments/availability/a" to (
                        200 to window("a", 1, active = false)
                        ),
                ),
            ),
        )

        subject.load()

        assertTrue(subject.setOpen(subject.state.value.windows.single(), open = false))
        assertEquals(1, subject.state.value.windows.size)
        assertTrue(subject.state.value.open.isEmpty())
    }

    /** Removing takes the row away and can empty the week. */
    @Test
    fun `removing the last window empties the week`() = runTest {
        val subject = model(
            AvailabilityTransport(
                mapOf(
                    "GET appointments/availability" to (200 to "[${window("a", 1)}]"),
                    "DELETE appointments/availability/a" to (204 to ""),
                ),
            ),
        )

        subject.load()

        assertTrue(subject.remove(subject.state.value.windows.single()))
        assertEquals(AvailabilityPhase.None, subject.state.value.phase)
    }

    @Test
    fun `a refused change leaves the window as it was`() = runTest {
        val subject = model(
            AvailabilityTransport(
                mapOf(
                    "GET appointments/availability" to (200 to "[${window("a", 1)}]"),
                    "PATCH appointments/availability/a" to (403 to """{"message":"forbidden"}"""),
                ),
            ),
        )

        subject.load()

        assertFalse(subject.setOpen(subject.state.value.windows.single(), open = false))
        assertEquals(1, subject.state.value.open.size)
        assertNotNull(subject.state.value.error)
    }
}
