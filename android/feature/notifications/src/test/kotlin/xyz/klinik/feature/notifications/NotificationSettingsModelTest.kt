package xyz.klinik.feature.notifications

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ApiError
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.NotificationChannel
import xyz.klinik.network.NotificationDeliveryStatus
import xyz.klinik.network.NotificationKind
import xyz.klinik.network.NotificationsApi
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher
import xyz.klinik.network.UiText

private class RecordingTransport(
    private val bodies: Map<String, Pair<Int, String>>,
    private val delays: Map<String, Long> = emptyMap(),
) : HttpTransport {
    val calls = mutableListOf<String>()
    val sent = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/").substringBefore("?")
        val key = "${request.method} $path"
        calls += key
        request.body?.let { sent += it }

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
        error("Settings must not refresh")
}

private fun preference(
    type: String,
    channel: String = "PUSH",
    enabled: Boolean = true,
    quiet: Pair<String, String>? = null,
) = """
    {"type":"$type","channel":"$channel","enabled":$enabled,
     "quietHoursStart":${quiet?.let { "\"${it.first}\"" } ?: "null"},
     "quietHoursEnd":${quiet?.let { "\"${it.second}\"" } ?: "null"},
     "timezone":"Europe/Istanbul"}
""".trimIndent()

/**
 * The rule that matters is "absent means on": someone who never opened this
 * screen still hears that their results are ready. It has to be the same rule
 * the server applies, or the switch shows one thing and the clinic does another.
 */
class NotificationSettingsModelTest {
    private fun bodies(
        preferences: String = "[]",
        history: String = "[]",
        extra: Map<String, Pair<Int, String>> = emptyMap(),
    ): Map<String, Pair<Int, String>> = buildMap {
        put("GET me/notifications/preferences", 200 to preferences)
        put("GET me/notifications", 200 to history)
        putAll(extra)
    }

    private suspend fun model(transport: HttpTransport): NotificationSettingsModel {
        val session = SessionManager(InMemoryTokenStore(), UnusedRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))
        return NotificationSettingsModel(
            NotificationsApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
        )
    }

    @Test
    fun `loads preferences and history`() = runTest {
        val settings = model(
            RecordingTransport(
                bodies(
                    preferences = "[${preference("lab.ready", enabled = false)}]",
                    history = """
                        [{"id":"n1","type":"lab.ready","title":"Hazır","body":"…",
                          "channel":"PUSH","status":"FAILED","failureReason":"device unreachable",
                          "fallbackForId":null,"sentAt":null,"readAt":null,
                          "createdAt":"2026-03-01T08:00:00.000Z"}]
                    """.trimIndent(),
                ),
            ),
        )

        settings.load()

        assertEquals(SettingsPhase.Loaded, settings.state.value.phase)
        assertEquals(1, settings.state.value.preferences.size)
        assertEquals(NotificationDeliveryStatus.FAILED, settings.state.value.history[0].status)
    }

    /** Someone who never opened this screen still gets told their results are ready. */
    @Test
    fun `treats an absent preference as on`() = runTest {
        val settings = model(RecordingTransport(bodies()))

        settings.load()

        assertTrue(
            settings.state.value.isEnabled(NotificationKind.LAB_READY, NotificationChannel.PUSH),
        )
    }

    @Test
    fun `reports a stored false as off`() = runTest {
        val settings = model(
            RecordingTransport(bodies(preferences = "[${preference("lab.ready", enabled = false)}]")),
        )

        settings.load()

        assertFalse(
            settings.state.value.isEnabled(NotificationKind.LAB_READY, NotificationChannel.PUSH),
        )
        // A different channel of the same type is untouched.
        assertTrue(
            settings.state.value.isEnabled(NotificationKind.LAB_READY, NotificationChannel.SMS),
        )
    }

    @Test
    fun `saves a switch and keeps what the server returned`() = runTest {
        val settings = model(
            RecordingTransport(
                bodies(
                    extra = mapOf(
                        "PUT me/notifications/preferences" to (
                            200 to preference("lab.ready", enabled = false)
                            ),
                    ),
                ),
            ),
        )

        settings.load()
        val saved = settings.set(NotificationKind.LAB_READY, NotificationChannel.PUSH, false)

        assertTrue(saved)
        assertFalse(
            settings.state.value.isEnabled(NotificationKind.LAB_READY, NotificationChannel.PUSH),
        )
    }

    /**
     * A switch that stays flipped after the server refused is a setting the
     * person believes they made.
     */
    @Test
    fun `leaves the switch alone when saving fails`() = runTest {
        val settings = model(
            RecordingTransport(
                bodies(
                    extra = mapOf(
                        "PUT me/notifications/preferences" to (
                            400 to """{"statusCode":400,"message":"Bad request"}"""
                            ),
                    ),
                ),
            ),
        )

        settings.load()
        val saved = settings.set(NotificationKind.LAB_READY, NotificationChannel.PUSH, false)

        assertFalse(saved)
        assertTrue(
            settings.state.value.isEnabled(NotificationKind.LAB_READY, NotificationChannel.PUSH),
        )
        assertEquals(UiText.Literal("Bad request"), settings.state.value.error)
    }

    /** Turning a type off must not silently drop the quiet hours it had. */
    @Test
    fun `keeps quiet hours when toggling a type off`() = runTest {
        val transport = RecordingTransport(
            bodies(
                preferences = "[${preference("lab.ready", quiet = "22:00" to "08:00")}]",
                extra = mapOf(
                    "PUT me/notifications/preferences" to (
                        200 to preference("lab.ready", enabled = false, quiet = "22:00" to "08:00")
                        ),
                ),
            ),
        )
        val settings = model(transport)

        settings.load()
        settings.set(NotificationKind.LAB_READY, NotificationChannel.PUSH, false)

        assertTrue(transport.sent.last().contains("\"quietHoursStart\":\"22:00\""))
        assertTrue(transport.sent.last().contains("\"quietHoursEnd\":\"08:00\""))
    }

    @Test
    fun `saves quiet hours`() = runTest {
        val settings = model(
            RecordingTransport(
                bodies(
                    extra = mapOf(
                        "PUT me/notifications/preferences" to (
                            200 to preference("lab.ready", quiet = "22:00" to "08:00")
                            ),
                    ),
                ),
            ),
        )

        settings.load()
        val saved = settings.setQuietHours(NotificationKind.LAB_READY, "22:00", "08:00")

        assertTrue(saved)
        assertEquals(
            "22:00" to "08:00",
            settings.state.value.quietHours(NotificationKind.LAB_READY),
        )
    }

    /** A double tap must not send two conflicting saves. */
    @Test
    fun `refuses a second save while one is in flight`() = runTest {
        val transport = RecordingTransport(
            bodies(
                extra = mapOf(
                    "PUT me/notifications/preferences" to (
                        200 to preference("lab.ready", enabled = false)
                        ),
                ),
            ),
            delays = mapOf("PUT me/notifications/preferences" to 300),
        )
        val settings = model(transport)

        settings.load()

        val first = async { settings.set(NotificationKind.LAB_READY, NotificationChannel.PUSH, false) }
        val second = async { settings.set(NotificationKind.LAB_READY, NotificationChannel.PUSH, true) }

        val results = listOf(first.await(), second.await())

        assertEquals(1, results.count { it })
    }

    /**
     * A patient who was never reached should be able to see the clinic tried,
     * and which attempt stood in for which.
     */
    @Test
    fun `shows the fallback chain`() = runTest {
        val settings = model(
            RecordingTransport(
                bodies(
                    history = """
                        [{"id":"n2","type":"lab.critical","title":"Kritik","body":"…",
                          "channel":"SMS","status":"SENT","failureReason":null,
                          "fallbackForId":"n1","sentAt":"2026-03-01T08:01:00.000Z",
                          "readAt":null,"createdAt":"2026-03-01T08:01:00.000Z"}]
                    """.trimIndent(),
                ),
            ),
        )

        settings.load()

        assertTrue(settings.state.value.history[0].isFallback)
        assertEquals(NotificationChannel.SMS, settings.state.value.history[0].channel)
    }

    @Test
    fun `reports a failure to load`() = runTest {
        val settings = model(FailingTransport(ApiError.Offline))

        settings.load()

        assertTrue(settings.state.value.phase is SettingsPhase.Failed)
    }

    /**
     * Registering is best-effort: a device that could not register must not stop
     * the person using the app.
     */
    @Test
    fun `device registration does not throw`() = runTest {
        val settings = model(FailingTransport(ApiError.Offline))

        settings.registerDevice("tok", "dev")
        settings.forgetDevice("tok")
    }
}
