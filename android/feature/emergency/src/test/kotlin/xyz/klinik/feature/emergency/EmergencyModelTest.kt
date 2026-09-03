package xyz.klinik.feature.emergency

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ApiError
import xyz.klinik.network.EmergencyApi
import xyz.klinik.network.EmergencyStatus
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private class RecordingTransport(
    private val bodies: Map<String, Pair<Int, String>>,
) : HttpTransport {
    val calls = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/").substringBefore("?")
        val key = "${request.method} $path"
        calls += key

        val (status, body) = bodies[key] ?: (500 to "{}")
        return HttpResponse(status, body)
    }
}

private class FailingTransport(private val error: ApiError) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse = throw error
}

private object UnusedRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("The emergency button must not refresh a session")
}

private val card = """
    {"language":"tr","emergencyNumber":{"number":"112","countryCode":"TR","source":"country"},
     "steps":[{"id":"call-local","text":"112 arayın","critical":true},
              {"id":"stay-put","text":"Bulunduğunuz yerde kalın","critical":false}]}
""".trimIndent()

private fun event(id: String = "e1", status: String = "TRIGGERED") = """
    {"id":"$id","patientId":"p1","status":"$status","triggeredAt":"2026-03-04T10:00:00.000Z",
     "latitude":null,"longitude":null,"note":null,"escalationLevel":0,
     "acknowledgedAt":null,"resolution":null,"resolvedAt":null}
""".trimIndent()

private fun view(id: String = "e1", status: String = "TRIGGERED", alreadyOpen: Boolean = false) =
    """{"event":${event(id, status)},"guidance":$card,"alreadyOpen":$alreadyOpen}"""

/**
 * The emergency button.
 *
 * Two of these tests are about things *not* happening: a single press must not
 * raise an alarm, and a slow GPS must not hold one up. Both are failures that
 * only show up in the field.
 */
class EmergencyModelTest {
    private var clock = 0L

    private suspend fun model(
        transport: HttpTransport,
        locator: EmergencyLocating? = null,
        locationTimeoutMillis: Long = 50,
        armedWindowMillis: Long = 10_000,
    ): EmergencyModel {
        val session = SessionManager(InMemoryTokenStore(), UnusedRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return EmergencyModel(
            api = EmergencyApi(
                ApiClient(ApiConfiguration("https://api.test"), transport, session),
            ),
            locator = locator,
            locationTimeoutMillis = locationTimeoutMillis,
            armedWindowMillis = armedWindowMillis,
            now = { clock },
        )
    }

    @Test
    fun `one press does not raise an alarm`() = runTest {
        val transport = RecordingTransport(mapOf("POST me/emergency" to (201 to view())))
        val subject = model(transport)

        subject.arm()

        assertEquals(EmergencyPhase.Armed, subject.state.value.phase)
        // A single button that raises a clinical alarm will be pressed by a
        // pocket.
        assertTrue(transport.calls.isEmpty())
    }

    @Test
    fun `two presses raise it`() = runTest {
        val transport = RecordingTransport(mapOf("POST me/emergency" to (201 to view())))
        val subject = model(transport)

        subject.arm()

        assertTrue(subject.confirm())
        assertEquals(EmergencyPhase.Raised, subject.state.value.phase)
        assertEquals("e1", subject.state.value.event?.id)
        assertEquals("112", subject.state.value.card?.emergencyNumber?.number)
    }

    @Test
    fun `confirming without arming does nothing`() = runTest {
        val transport = RecordingTransport(mapOf("POST me/emergency" to (201 to view())))
        val subject = model(transport)

        assertFalse(subject.confirm())
        assertTrue(transport.calls.isEmpty())
        assertEquals(EmergencyPhase.Idle, subject.state.value.phase)
    }

    /**
     * A pocket that armed the button must not leave it primed for the next
     * pocket. The window closing puts the screen back to one button.
     */
    @Test
    fun `the arming window closes on its own`() = runTest {
        val transport = RecordingTransport(mapOf("POST me/emergency" to (201 to view())))
        val subject = model(transport, armedWindowMillis = 1_000)

        subject.arm()
        clock += 1_500

        assertFalse(subject.confirm())
        assertTrue(transport.calls.isEmpty())
        assertEquals(EmergencyPhase.Idle, subject.state.value.phase)
    }

    /**
     * The rule this test exists for: a cold GPS takes fifteen seconds, and the
     * alarm is worth more than the pin. Losing the race is not an error.
     */
    @Test
    fun `does not wait for a location that never arrives`() = runTest {
        val transport = RecordingTransport(mapOf("POST me/emergency" to (201 to view())))
        val subject = model(
            transport,
            locator = {
                delay(30_000)
                null
            },
            locationTimeoutMillis = 50,
        )

        subject.arm()

        assertTrue(subject.confirm())
        assertEquals(EmergencyPhase.Raised, subject.state.value.phase)
    }

    @Test
    fun `sends the location when the device has one`() = runTest {
        val transport = RecordingTransport(mapOf("POST me/emergency" to (201 to view())))
        val subject = model(transport, locator = { Coordinates(41.0082, 28.9784) })

        subject.arm()

        assertTrue(subject.confirm())
        assertEquals(EmergencyPhase.Raised, subject.state.value.phase)
    }

    /**
     * The network being down is exactly when the local ambulance matters most,
     * so a failed trigger must not take the phone number off the screen.
     */
    @Test
    fun `a failed alarm keeps the number that was already on screen`() = runTest {
        val prefetched = RecordingTransport(
            mapOf(
                "GET me/emergency/active" to (200 to "null"),
                "GET me/emergency/guidance" to (200 to card),
            ),
        )
        val subject = model(prefetched)
        subject.prefetch()

        assertEquals("112", subject.state.value.card?.emergencyNumber?.number)

        val offline = model(FailingTransport(ApiError.Offline))
        offline.arm()

        assertFalse(offline.confirm())
        assertTrue(offline.state.value.phase is EmergencyPhase.Failed)
    }

    @Test
    fun `prefetch picks up a call that is already open`() = runTest {
        val subject = model(
            RecordingTransport(
                mapOf("GET me/emergency/active" to (200 to view(alreadyOpen = true))),
            ),
        )

        subject.prefetch()

        assertEquals(EmergencyPhase.Raised, subject.state.value.phase)
        assertTrue(subject.state.value.alreadyOpen)
        assertEquals("e1", subject.state.value.event?.id)
    }

    @Test
    fun `cancels an alarm nobody has picked up`() = runTest {
        val subject = model(
            RecordingTransport(
                mapOf(
                    "POST me/emergency" to (201 to view()),
                    "PATCH me/emergency/e1/cancel" to (200 to event(status = "FALSE_ALARM")),
                ),
            ),
        )

        subject.arm()
        subject.confirm()

        assertTrue(subject.cancel())
        assertEquals(EmergencyStatus.FALSE_ALARM, subject.state.value.event?.status)
        assertEquals(EmergencyPhase.Idle, subject.state.value.phase)
    }

    /** Once a clinician has it, the patient's "never mind" is not theirs to give. */
    @Test
    fun `will not cancel once the clinic is handling it`() = runTest {
        val transport = RecordingTransport(
            mapOf(
                "GET me/emergency/active" to (200 to view(status = "ACKNOWLEDGED")),
                "PATCH me/emergency/e1/cancel" to (200 to event(status = "FALSE_ALARM")),
            ),
        )
        val subject = model(transport)

        subject.prefetch()

        assertFalse(subject.cancel())
        assertFalse(transport.calls.contains("PATCH me/emergency/e1/cancel"))
        assertEquals(EmergencyStatus.ACKNOWLEDGED, subject.state.value.event?.status)
    }

    @Test
    fun `the card separates the line that points away from the clinic`() = runTest {
        val subject = model(
            RecordingTransport(
                mapOf(
                    "GET me/emergency/active" to (200 to "null"),
                    "GET me/emergency/guidance" to (200 to card),
                ),
            ),
        )

        subject.prefetch()

        val guidance = assertNotNull(subject.state.value.card)
        assertEquals("call-local", guidance.criticalStep?.id)
        assertEquals(1, guidance.ordinarySteps.size)
        assertFalse(guidance.emergencyNumber.isGuess)
        assertEquals("tel:112", guidance.emergencyNumber.dialUri)
    }

    /**
     * An empty body and a literal `null` both mean "nothing open". Neither is
     * an error, and treating either as one would put a red screen in front of a
     * patient who has no emergency.
     */
    @Test
    fun `an absent open call is not a failure`() = runTest {
        val subject = model(
            RecordingTransport(
                mapOf(
                    "GET me/emergency/active" to (200 to ""),
                    "GET me/emergency/guidance" to (200 to card),
                ),
            ),
        )

        subject.prefetch()

        assertEquals(EmergencyPhase.Idle, subject.state.value.phase)
        assertNotNull(subject.state.value.card)
    }
}
