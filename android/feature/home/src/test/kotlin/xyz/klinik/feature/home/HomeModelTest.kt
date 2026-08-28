package xyz.klinik.feature.home

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ApiError
import xyz.klinik.network.ErrorResponse
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.MeApi
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private class StatusTransport(private val status: Int, private val body: String) : HttpTransport {
    override suspend fun send(request: HttpRequest) = HttpResponse(status, body)
}

private object UnusedRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens = error("no refresh")
}

class HomeModelTest {
    private fun summaryBody(
        unread: Int = 0,
        due: Int = 0,
        missing: Int = 0,
        appointment: Boolean = false,
    ): String {
        val next = if (appointment) {
            """{"id":"a1","scheduledAt":"2026-09-01T09:00:00.000Z","type":"CONTROL","location":"Klinik"}"""
        } else {
            "null"
        }

        return """
            {"patient":{"id":"p1","mrn":"2026-K7RMPX","firstName":"Ayse","lastName":"Yilmaz",
             "preferredLanguage":"tr","status":"POST_OP"},
             "nextAppointment":$next,"medicationsDueToday":$due,
             "unreadMessages":$unread,"missingDocuments":$missing}
        """.trimIndent()
    }

    private suspend fun model(transport: HttpTransport): HomeModel {
        val session = SessionManager(InMemoryTokenStore(), UnusedRefresher)
        session.signIn(SessionTokens("a", "r", System.currentTimeMillis() + 900_000))
        val client = ApiClient(ApiConfiguration("https://api.test"), transport, session)
        return HomeModel(MeApi(client))
    }

    @Test
    fun `loads the summary`() = runTest {
        val home = model(StatusTransport(200, summaryBody(appointment = true)))

        home.load()

        val phase = home.state.value.phase
        assertTrue(phase is HomePhase.Loaded)
        assertEquals("Ayse Yilmaz", phase.summary.patient.fullName)
        assertTrue(phase.summary.nextAppointment != null)
    }

    /**
     * A tile reading "0" tells the reader nothing and competes for attention
     * with the ones that matter.
     */
    @Test
    fun `shows no badge for a zero count`() = runTest {
        val home = model(StatusTransport(200, summaryBody()))

        home.load()

        assertEquals(emptyMap<HomeAction, Int>(), home.state.value.badges)
    }

    @Test
    fun `badges only the counts that are non zero`() = runTest {
        val home = model(StatusTransport(200, summaryBody(unread = 3, due = 0, missing = 2)))

        home.load()

        assertEquals(3, home.state.value.badges[HomeAction.MESSAGES])
        assertEquals(2, home.state.value.badges[HomeAction.UPLOAD_DOCUMENT])
        assertNull(home.state.value.badges[HomeAction.MEDICATIONS])
    }

    /**
     * Not a failure to retry: the account simply has no file yet, so the screen
     * explains instead of offering a button that will not help.
     */
    @Test
    fun `reports an unlinked account as its own state`() = runTest {
        val home = model(StatusTransport(404, "{}"))

        home.load()

        assertEquals<HomePhase>(HomePhase.NoPatientFile, home.state.value.phase)
    }

    @Test
    fun `reports other failures with a message key`() = runTest {
        val home = model(StatusTransport(503, "{}"))

        home.load()

        assertEquals<HomePhase>(HomePhase.Failed("error.server"), home.state.value.phase)
    }

    /**
     * Spec section 7 caps the patient home at five actions. The limit is the
     * point: a sixth would be a decision to make the screen harder for the
     * people least able to absorb it.
     */
    @Test
    fun `offers exactly five primary actions`() {
        assertEquals(5, HomeAction.entries.size)
    }

    @Test
    fun `every action has an icon and a title key`() {
        for (action in HomeAction.entries) {
            assertTrue(action.iconName.isNotEmpty())
            assertTrue(action.titleKey.startsWith("home.action."))
        }
    }
}

private class RecordingTrigger(private val error: Throwable? = null) : EmergencyTrigger {
    var callCount = 0
        private set
    val notes = mutableListOf<String?>()

    override suspend fun trigger(note: String?) {
        callCount += 1
        notes += note
        error?.let { throw it }
    }
}

class EmergencyModelTest {
    /** A stray tap in a pocket must not summon the clinic. */
    @Test
    fun `the first tap arms but sends nothing`() = runTest {
        val trigger = RecordingTrigger()
        val model = EmergencyModel(trigger, this, confirmationWindowSeconds = 5)

        model.arm()

        assertTrue(model.state.value is EmergencyPhase.Confirming)
        assertEquals(0, trigger.callCount)
        model.cancel()
    }

    @Test
    fun `the second tap sends`() = runTest {
        val trigger = RecordingTrigger()
        val model = EmergencyModel(trigger, this, confirmationWindowSeconds = 5)

        model.arm("Yara kanıyor")
        model.confirm()

        assertEquals<EmergencyPhase>(EmergencyPhase.Sent, model.state.value)
        assertEquals(listOf<String?>("Yara kanıyor"), trigger.notes)
    }

    /** A button that stays armed indefinitely is one a pocket eventually presses. */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `it disarms itself when the window passes`() = runTest {
        val trigger = RecordingTrigger()
        val model = EmergencyModel(trigger, this, confirmationWindowSeconds = 3)

        model.arm()
        advanceTimeBy(4_000)
        advanceUntilIdle()

        assertEquals<EmergencyPhase>(EmergencyPhase.Idle, model.state.value)
        assertEquals(0, trigger.callCount)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `confirming after the window sends nothing`() = runTest {
        val trigger = RecordingTrigger()
        val model = EmergencyModel(trigger, this, confirmationWindowSeconds = 3)

        model.arm()
        advanceTimeBy(4_000)
        advanceUntilIdle()
        model.confirm()

        assertEquals(0, trigger.callCount)
    }

    @Test
    fun `cancel disarms`() = runTest {
        val trigger = RecordingTrigger()
        val model = EmergencyModel(trigger, this, confirmationWindowSeconds = 5)

        model.arm()
        model.cancel()
        model.confirm()

        assertEquals<EmergencyPhase>(EmergencyPhase.Idle, model.state.value)
        assertEquals(0, trigger.callCount)
    }

    /**
     * The property that matters most.
     *
     * Reporting "the clinic has been notified" when nothing was sent would
     * leave someone waiting for help that is not coming.
     */
    @Test
    fun `a failure never reads as success`() = runTest {
        val trigger = RecordingTrigger(ApiError.Offline)
        val model = EmergencyModel(trigger, this, confirmationWindowSeconds = 5)

        model.arm()
        model.confirm()

        val phase = model.state.value
        assertTrue(phase is EmergencyPhase.Failed)
        assertTrue(phase.canRetry)
        assertEquals("emergency.notSentRetry", phase.messageKey)
    }

    @Test
    fun `success is only reported after the server accepts`() = runTest {
        val trigger = RecordingTrigger(ApiError.Server(ErrorResponse(statusCode = 500)))
        val model = EmergencyModel(trigger, this, confirmationWindowSeconds = 5)

        model.arm()
        model.confirm()

        assertNotEquals<EmergencyPhase>(EmergencyPhase.Sent, model.state.value)
    }

    @Test
    fun `a failed alert can be sent again`() = runTest {
        val trigger = RecordingTrigger(ApiError.Offline)
        val model = EmergencyModel(trigger, this, confirmationWindowSeconds = 5)

        model.arm()
        model.confirm()
        model.acknowledge()
        model.arm()
        model.confirm()

        assertEquals(2, trigger.callCount)
    }

    @Test
    fun `arming twice does not restart the window`() = runTest {
        val trigger = RecordingTrigger()
        val model = EmergencyModel(trigger, this, confirmationWindowSeconds = 5)

        model.arm("first")
        model.arm("second")
        model.confirm()

        assertEquals(listOf<String?>("first"), trigger.notes)
    }
}
