package xyz.klinik.feature.messaging

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import xyz.klinik.network.ChatMessage
import xyz.klinik.network.TriageLevel

private val json = Json { ignoreUnknownKeys = true }

private fun message(
    triageLevel: String = "null",
    triageFlags: String = "[]",
    aiSummary: String = "null",
    body: String = "Merhaba",
) = json.decodeFromString<ChatMessage>(
    """
    {"id":"m1","conversationId":"c1","senderId":"u1","type":"TEXT",
     "body":"$body","transcript":null,"status":"SENT",
     "queuedUntil":null,"readAt":null,
     "triageLevel":$triageLevel,"triageFlags":$triageFlags,
     "aiTriageLevel":null,"aiSummary":$aiSummary,
     "createdAt":"2026-03-01T08:00:00.000Z"}
    """.trimIndent(),
)

/**
 * Triage, as the chat screen sees it (spec M4, M5).
 *
 * The client's only job here is to render what the server decided and to keep
 * the summary next to the message rather than in place of it.
 */
class TriageRenderingTest {
    @Test
    fun `marks an urgent message for attention`() {
        val urgent = message(triageLevel = "\"URGENT\"", triageFlags = """["fever"]""")

        assertTrue(urgent.needsAttention)
        assertEquals(listOf("fever"), urgent.triageFlags)
    }

    @Test
    fun `leaves an ordinary message alone`() {
        assertFalse(message(triageLevel = "\"ROUTINE\"").needsAttention)
        assertFalse(message().needsAttention)
    }

    /**
     * The summary never replaces what the patient wrote. A clinician reading a
     * three-line paraphrase of a message they cannot see is reading the model,
     * not the patient.
     */
    @Test
    fun `keeps the summary beside the message and not instead of it`() {
        val summarised = message(
            body = "Ateşim 38.5 ve yarada akıntı var",
            triageLevel = "\"URGENT\"",
            aiSummary = "\"Şikayet: yarada akıntı\"",
        )

        assertEquals("Ateşim 38.5 ve yarada akıntı var", summarised.body)
        assertEquals("Şikayet: yarada akıntı", summarised.aiSummary)
    }

    /** An older server does not send these fields; that is not a crash. */
    @Test
    fun `tolerates a response without the triage fields`() {
        val old = json.decodeFromString<ChatMessage>(
            """
            {"id":"m1","conversationId":"c1","senderId":"u1","type":"TEXT",
             "body":"Merhaba","status":"SENT","createdAt":"2026-03-01T08:00:00.000Z"}
            """.trimIndent(),
        )

        assertFalse(old.needsAttention)
        assertEquals(emptyList(), old.triageFlags)
    }

    @Test
    fun `has a string key for every level`() {
        for (level in TriageLevel.entries) {
            assertTrue(level.stringKey.startsWith("triage_level_"))
        }
    }
}
