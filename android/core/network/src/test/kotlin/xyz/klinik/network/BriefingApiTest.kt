package xyz.klinik.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

private val busy = """
    {"facts":{"generatedAt":"2026-03-04T05:00:00.000Z",
      "yesterday":{"newMessages":7,"urgentMessages":2,"emergencies":1,
                   "complications":0,"criticalLabs":3},
      "today":{"appointments":5,"followUps":2},
      "atRisk":[{"patientId":"p1","patientName":"Ayşe Yılmaz",
                 "kind":"emergency-unanswered","detail":"Acil çağrı yanıtlanmadı",
                 "waitingMinutes":20}]},
     "narrative":"Bir acil çağrı bekliyor.","quiet":false}
""".trimIndent()

/**
 * The morning briefing, as the doctor's screen sees it.
 *
 * The one property worth a test on the client: the screen is rendered from the
 * facts, not from the paragraph — otherwise a switched-off AI layer looks like
 * an empty morning.
 */
class BriefingApiTest {
    @Test
    fun `reads the facts and the paragraph`() {
        val briefing = json.decodeFromString<Briefing>(busy)

        assertEquals(7, briefing.facts.yesterday.newMessages)
        assertEquals(5, briefing.facts.today.appointments)
        assertEquals("Bir acil çağrı bekliyor.", briefing.narrative)
        assertTrue(briefing.hasContent)
    }

    /**
     * A briefing with no paragraph is still a briefing. Rendering the screen off
     * the prose would make a switched-off AI layer look like an empty morning.
     */
    @Test
    fun `shows the briefing when there is no paragraph`() {
        val briefing = json.decodeFromString<Briefing>(
            busy.replace("\"narrative\":\"Bir acil çağrı bekliyor.\"", "\"narrative\":null"),
        )

        assertNull(briefing.narrative)
        assertTrue(briefing.hasContent)
        assertEquals(1, briefing.facts.atRisk.size)
    }

    @Test
    fun `says nothing is waiting on a quiet morning`() {
        val briefing = json.decodeFromString<Briefing>(
            """
            {"facts":{"generatedAt":"2026-03-04T05:00:00.000Z","atRisk":[]},
             "narrative":null,"quiet":true}
            """.trimIndent(),
        )

        assertFalse(briefing.hasContent)
        assertTrue(briefing.facts.atRisk.isEmpty())
    }

    @Test
    fun `reads every kind of risk the server can send`() {
        for (wire in listOf(
            "emergency-unanswered",
            "message-urgent",
            "complication-overdue",
            "follow-up-missed",
            "report-unreviewed",
        )) {
            val item = json.decodeFromString<RiskItem>(
                """{"patientId":"p1","patientName":"X","kind":"$wire","detail":"d","waitingMinutes":5}""",
            )

            assertTrue(item.kind.stringKey.startsWith("briefing_risk_"))
        }
    }

    /** A doctor does not read "4,320 minutes". */
    @Test
    fun `writes a long wait in hours`() {
        val recent = json.decodeFromString<RiskItem>(
            """{"patientId":"p1","patientName":"X","kind":"message-urgent","detail":"d","waitingMinutes":20}""",
        )
        val old = json.decodeFromString<RiskItem>(
            """{"patientId":"p2","patientName":"X","kind":"follow-up-missed","detail":"d","waitingMinutes":4320}""",
        )

        assertFalse(recent.showsHours)
        assertTrue(old.showsHours)
        assertEquals(72, old.waitingHours)
    }
}
