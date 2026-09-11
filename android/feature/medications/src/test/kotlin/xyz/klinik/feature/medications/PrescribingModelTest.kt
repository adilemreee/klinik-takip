package xyz.klinik.feature.medications

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.MedicationsApi
import xyz.klinik.network.Prescription
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object PrescribingRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading a plan must not refresh a session")
}

private class PrescribingTransport(
    private val bodies: MutableMap<String, Pair<Int, String>>,
) : HttpTransport {
    val calls = mutableListOf<Pair<String, String>>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        calls += "${request.method} $path" to request.body.orEmpty()

        val (status, body) = bodies["${request.method} $path"] ?: (500 to "{}")

        return HttpResponse(status, body)
    }

    fun answer(key: String, status: Int, body: String) {
        bodies[key] = status to body
    }
}

private fun view(
    id: String,
    approved: Boolean = true,
    stopped: Boolean = false,
) = """
    {"medication":{"id":"$id","patientId":"p1","drugName":"Parasetamol","dose":"500 mg",
      "form":"tablet","frequencyRule":"FREQ=DAILY;BYHOUR=9,21","timezone":"Europe/Berlin",
      "startDate":"2026-09-01T00:00:00.000Z","endDate":null,"instructions":null,
      "source":"PRESCRIBED",
      "approvedAt":${if (approved) "\"2026-09-01T08:00:00.000Z\"" else "null"},
      "stoppedAt":${if (stopped) "\"2026-09-10T08:00:00.000Z\"" else "null"}},
     "schedule":"Her gün 09:00 ve 21:00","adherence":{"taken":4,"missed":0,"due":4,
      "upcoming":10,"streak":2},"badges":[],"nextDose":null}
""".trimIndent()

private const val INTERACTIONS_CLEAN = """
    {"warnings":[],"unrecognised":[],"comparedPairs":3}
"""

private const val INTERACTIONS_BLIND = """
    {"warnings":[],"unrecognised":[{"id":"m9","drugName":"Bilinmeyen"}],"comparedPairs":0}
"""

/**
 * The clinician's side of the medication module (spec M9).
 *
 * What is held to here is the separation a merged list would destroy —
 * something the patient says they take is not something a doctor prescribed —
 * and that a write never looks applied unless the server applied it.
 */
class PrescribingModelTest {
    private fun transport(vararg bodies: Pair<String, Pair<Int, String>>) =
        PrescribingTransport(bodies.toMap().toMutableMap())

    private suspend fun model(transport: PrescribingTransport): PrescribingModel {
        val session = SessionManager(InMemoryTokenStore(), PrescribingRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return PrescribingModel(
            MedicationsApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
            patientId = "p1",
        )
    }

    /**
     * What the patient reported is kept apart from what a doctor wrote.
     *
     * Unapproved entries generate no doses and count towards no adherence; a
     * clinician reading one merged list would take them for prescriptions.
     */
    @Test
    fun `reported medication is listed apart from prescribed`() = runTest {
        val subject = model(
            transport(
                "GET patients/p1/medications" to (
                    200 to "[${view("a")},${view("b", approved = false)},${view("c", stopped = true)}]"
                    ),
                "GET patients/p1/medications/interactions" to (200 to INTERACTIONS_CLEAN),
            ),
        )

        subject.load()

        assertEquals(listOf("a"), subject.state.value.active.map { it.medication.id })
        assertEquals(listOf("b"), subject.state.value.awaitingApproval.map { it.medication.id })
        assertEquals(listOf("c"), subject.state.value.stopped.map { it.medication.id })
    }

    /**
     * The reference being unavailable must not stop a doctor reading the plan.
     */
    @Test
    fun `the plan loads when the interaction check does not`() = runTest {
        val subject = model(
            transport(
                "GET patients/p1/medications" to (200 to "[${view("a")}]"),
                "GET patients/p1/medications/interactions" to (500 to "{}"),
            ),
        )

        subject.load()

        assertEquals(PrescribingPhase.Loaded, subject.state.value.phase)
        assertNull(subject.state.value.interactions)
    }

    /**
     * Nothing compared is not a clean bill of health.
     *
     * The model carries `comparedPairs` through untouched so the screen can
     * say which of the two it is.
     */
    @Test
    fun `an unrecognised drug is carried rather than read as safe`() = runTest {
        val subject = model(
            transport(
                "GET patients/p1/medications" to (200 to "[${view("a")}]"),
                "GET patients/p1/medications/interactions" to (200 to INTERACTIONS_BLIND),
            ),
        )

        subject.load()

        val check = subject.state.value.interactions

        assertNotNull(check)
        assertFalse(check.checkedAnything)
        assertEquals(1, check.unrecognised.size)
    }

    /** Nothing at all is a state, not an error. */
    @Test
    fun `a patient on nothing is not a failure`() = runTest {
        val subject = model(
            transport(
                "GET patients/p1/medications" to (200 to "[]"),
                "GET patients/p1/medications/interactions" to (200 to INTERACTIONS_CLEAN),
            ),
        )

        subject.load()

        assertEquals(PrescribingPhase.Empty, subject.state.value.phase)
    }

    /**
     * A refused approval does not look applied.
     *
     * Flipping the row locally would show a clinician an approved course the
     * server never approved, and the patient would see no doses for it.
     */
    @Test
    fun `a refused approval leaves the row waiting`() = runTest {
        val subject = model(
            transport(
                "GET patients/p1/medications" to (200 to "[${view("b", approved = false)}]"),
                "GET patients/p1/medications/interactions" to (200 to INTERACTIONS_CLEAN),
                "PATCH medications/b/approve" to (403 to """{"message":"forbidden"}"""),
            ),
        )

        subject.load()

        assertFalse(subject.approve("b"))
        assertEquals(listOf("b"), subject.state.value.awaitingApproval.map { it.medication.id })
        assertNotNull(subject.state.value.error)
        assertNull(subject.state.value.busyId)
    }

    @Test
    fun `an approval takes the row the server returned`() = runTest {
        val subject = model(
            transport(
                "GET patients/p1/medications" to (200 to "[${view("b", approved = false)}]"),
                "GET patients/p1/medications/interactions" to (200 to INTERACTIONS_CLEAN),
                "PATCH medications/b/approve" to (200 to view("b", approved = true)),
            ),
        )

        subject.load()

        assertTrue(subject.approve("b"))
        assertEquals(listOf("b"), subject.state.value.active.map { it.medication.id })
        assertTrue(subject.state.value.awaitingApproval.isEmpty())
    }

    /**
     * A new prescription is read back rather than inserted.
     *
     * The server generates the doses and recomputes the check; a locally
     * inserted row would show a schedule nobody confirmed.
     */
    @Test
    fun `prescribing reloads the plan from the server`() = runTest {
        val transport = transport(
            "GET patients/p1/medications" to (200 to "[]"),
            "GET patients/p1/medications/interactions" to (200 to INTERACTIONS_CLEAN),
            "POST patients/p1/medications" to (200 to view("new")),
        )
        val subject = model(transport)

        subject.load()
        transport.answer("GET patients/p1/medications", 200, "[${view("new")}]")

        assertTrue(
            subject.prescribe(
                Prescription(
                    drugName = "Parasetamol",
                    dose = "500 mg",
                    frequencyRule = "FREQ=DAILY;BYHOUR=9,21",
                    startDate = "2026-09-12T00:00:00.000Z",
                    timezone = "Europe/Berlin",
                ),
            ),
        )

        assertEquals(listOf("new"), subject.state.value.active.map { it.medication.id })
        // The timezone travels with it: a dose is a wall-clock event, and
        // "nine in the morning" means the patient's morning.
        assertTrue(
            transport.calls.any { it.first.startsWith("POST") && "Europe/Berlin" in it.second },
        )
    }

    @Test
    fun `stopping a course keeps it on the record`() = runTest {
        val subject = model(
            transport(
                "GET patients/p1/medications" to (200 to "[${view("a")}]"),
                "GET patients/p1/medications/interactions" to (200 to INTERACTIONS_CLEAN),
                "PATCH medications/a/stop" to (200 to view("a", stopped = true)),
            ),
        )

        subject.load()

        assertTrue(subject.stop("a"))
        assertEquals(listOf("a"), subject.state.value.stopped.map { it.medication.id })
        assertTrue(subject.state.value.active.isEmpty())
    }
}
