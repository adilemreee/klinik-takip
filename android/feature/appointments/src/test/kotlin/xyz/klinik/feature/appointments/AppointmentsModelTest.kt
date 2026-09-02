package xyz.klinik.feature.appointments

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ApiError
import xyz.klinik.network.AppointmentStatus
import xyz.klinik.network.AppointmentType
import xyz.klinik.network.AppointmentsApi
import xyz.klinik.network.ErrorResponse
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher
import xyz.klinik.network.UiText

private class RecordingTransport(
    private val bodies: Map<String, Pair<Int, String>>,
    private val delays: Map<String, Long> = emptyMap(),
) : HttpTransport {
    val calls = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/").substringBefore("?")
        val key = "${request.method} $path"
        calls += key

        delays[key]?.let { delay(it) }

        val (status, body) = bodies[key] ?: (500 to "{}")
        return HttpResponse(status, body)
    }
}

private class FailingTransport(private val error: ApiError) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse = throw error
}

private object UnusedRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Appointments must not refresh")
}

private fun appointment(
    id: String,
    scheduledAt: String,
    status: String = "CONFIRMED",
) = """
    {"id":"$id","patientId":"p1","staffId":"s1","type":"CONTROL","status":"$status",
     "scheduledAt":"$scheduledAt","durationMinutes":30,"location":null,"note":null,
     "cancelledAt":null,"cancelledReason":null,"remindersSent":[]}
""".trimIndent()

/**
 * Appointments.
 *
 * A patient opens this for one answer — when do I come in — and a refused
 * booking has to say which kind of refusal it was, because "taken" and "the
 * clinic is shut" send them looking in different places.
 */
class AppointmentsModelTest {
    private val now = "2026-03-05T00:00:00.000Z"

    private suspend fun model(transport: HttpTransport): AppointmentsModel {
        val session = SessionManager(InMemoryTokenStore(), UnusedRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))
        return AppointmentsModel(
            AppointmentsApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
        )
    }

    @Test
    fun `loads appointments`() = runTest {
        val appointments = model(
            RecordingTransport(
                mapOf(
                    "GET me/appointments" to (
                        200 to "[${appointment("a1", "2026-03-10T09:00:00.000Z")}]"
                        ),
                ),
            ),
        )

        appointments.refresh()

        assertEquals(AppointmentsPhase.Loaded, appointments.state.value.phase)
        assertEquals(listOf("a1"), appointments.state.value.appointments.map { it.id })
    }

    /** Nothing booked is not a failure. */
    @Test
    fun `reports empty separately from failure`() = runTest {
        val appointments = model(RecordingTransport(mapOf("GET me/appointments" to (200 to "[]"))))

        appointments.refresh()

        assertEquals(AppointmentsPhase.Empty, appointments.state.value.phase)
    }

    /** The one answer the screen exists to give. */
    @Test
    fun `finds the next appointment still ahead`() = runTest {
        val appointments = model(
            RecordingTransport(
                mapOf(
                    "GET me/appointments" to (
                        200 to "[${appointment("past", "2026-03-01T09:00:00.000Z")}," +
                            "${appointment("soon", "2026-03-10T09:00:00.000Z")}," +
                            "${appointment("later", "2026-04-10T09:00:00.000Z")}]"
                        ),
                ),
            ),
        )

        appointments.refresh()

        assertEquals("soon", appointments.state.value.next(now)?.id)
    }

    /** A cancelled appointment is not the next one to come to. */
    @Test
    fun `skips cancelled when looking ahead`() = runTest {
        val appointments = model(
            RecordingTransport(
                mapOf(
                    "GET me/appointments" to (
                        200 to "[${appointment("cancelled", "2026-03-10T09:00:00.000Z", "CANCELLED")}," +
                            "${appointment("real", "2026-03-11T09:00:00.000Z")}]"
                        ),
                ),
            ),
        )

        appointments.refresh()

        assertEquals("real", appointments.state.value.next(now)?.id)
    }

    @Test
    fun `collects requests awaiting confirmation`() = runTest {
        val appointments = model(
            RecordingTransport(
                mapOf(
                    "GET me/appointments" to (
                        200 to "[${appointment("r1", "2026-03-10T09:00:00.000Z", "REQUESTED")}," +
                            "${appointment("c1", "2026-03-11T09:00:00.000Z")}]"
                        ),
                ),
            ),
        )

        appointments.refresh()

        assertEquals(listOf("r1"), appointments.state.value.awaitingConfirmation.map { it.id })
    }

    /**
     * "Taken" sends someone looking for another slot; "the clinic is shut"
     * sends them to another day. Saying the wrong one wastes their afternoon.
     */
    @Test
    fun `explains a taken slot and a closed clinic differently`() = runTest {
        val taken = model(
            RecordingTransport(
                mapOf(
                    "GET me/appointments" to (200 to "[]"),
                    "POST me/appointments" to (409 to """{"statusCode":409,"message":"SLOT_TAKEN"}"""),
                ),
            ),
        )

        taken.refresh()
        val booked = taken.request(AppointmentType.CONTROL, "2026-03-10T09:00:00.000Z", "s1")

        val closed = model(
            RecordingTransport(
                mapOf(
                    "GET me/appointments" to (200 to "[]"),
                    "POST me/appointments" to (
                        409 to """{"statusCode":409,"message":"OUTSIDE_AVAILABILITY"}"""
                        ),
                ),
            ),
        )

        closed.refresh()
        closed.request(AppointmentType.CONTROL, "2026-03-10T03:00:00.000Z", "s1")

        assertFalse(booked)
        assertEquals(UiText.Key("appointment.slotTaken"), taken.state.value.error)
        assertEquals(UiText.Key("appointment.outsideHours"), closed.state.value.error)
    }

    /**
     * A patient who cancelled should see that it is cancelled rather than watch
     * it vanish and wonder whether the clinic got the message.
     */
    @Test
    fun `keeps a cancelled appointment on screen`() = runTest {
        val at = "2026-03-10T09:00:00.000Z"

        val appointments = model(
            RecordingTransport(
                mapOf(
                    "GET me/appointments" to (200 to "[${appointment("a1", at)}]"),
                    "PATCH appointments/a1/cancel" to (
                        200 to appointment("a1", at, "CANCELLED")
                        ),
                ),
            ),
        )

        appointments.refresh()
        val cancelled = appointments.cancel("a1")

        assertTrue(cancelled)
        assertEquals(1, appointments.state.value.appointments.size)
        assertEquals(AppointmentStatus.CANCELLED, appointments.state.value.appointments[0].status)
        assertNull(appointments.state.value.next(now))
    }

    @Test
    fun `confirms a request`() = runTest {
        val at = "2026-03-10T09:00:00.000Z"

        val appointments = model(
            RecordingTransport(
                mapOf(
                    "GET me/appointments" to (200 to "[${appointment("a1", at, "REQUESTED")}]"),
                    "PATCH appointments/a1/confirm" to (200 to appointment("a1", at)),
                ),
            ),
        )

        appointments.refresh()
        val confirmed = appointments.confirm("a1")

        assertTrue(confirmed)
        assertEquals(AppointmentStatus.CONFIRMED, appointments.state.value.appointments[0].status)
        assertTrue(appointments.state.value.awaitingConfirmation.isEmpty())
    }

    /** A refused action must not leave the row looking as though it worked. */
    @Test
    fun `leaves the row alone when an action fails`() = runTest {
        val at = "2026-03-10T09:00:00.000Z"

        val appointments = model(
            RecordingTransport(
                mapOf(
                    "GET me/appointments" to (200 to "[${appointment("a1", at, "REQUESTED")}]"),
                    "PATCH appointments/a1/confirm" to (
                        400 to """{"statusCode":400,"message":"This appointment is already confirmed"}"""
                        ),
                ),
            ),
        )

        appointments.refresh()
        val confirmed = appointments.confirm("a1")

        assertFalse(confirmed)
        assertEquals(AppointmentStatus.REQUESTED, appointments.state.value.appointments[0].status)
        assertEquals(
            UiText.Literal("This appointment is already confirmed"),
            appointments.state.value.error,
        )
    }

    /** A double tap must not send two requests for the same slot. */
    @Test
    fun `refuses a second request while one is in flight`() = runTest {
        val transport = RecordingTransport(
            mapOf(
                "GET me/appointments" to (200 to "[]"),
                "POST me/appointments" to (
                    201 to appointment("a1", "2026-03-10T09:00:00.000Z", "REQUESTED")
                    ),
            ),
            delays = mapOf("POST me/appointments" to 300),
        )
        val appointments = model(transport)

        appointments.refresh()

        val first = async {
            appointments.request(AppointmentType.CONTROL, "2026-03-10T09:00:00.000Z", "s1")
        }
        val second = async {
            appointments.request(AppointmentType.CONTROL, "2026-03-10T09:00:00.000Z", "s1")
        }

        val results = listOf(first.await(), second.await())

        assertEquals(1, results.count { it })
        assertEquals(1, transport.calls.count { it == "POST me/appointments" })
    }

    @Test
    fun `treats not found as its own state`() = runTest {
        val appointments = model(FailingTransport(ApiError.NotFound(ErrorResponse(statusCode = 404))))

        appointments.refresh()

        assertEquals(AppointmentsPhase.NotFound, appointments.state.value.phase)
    }
}
