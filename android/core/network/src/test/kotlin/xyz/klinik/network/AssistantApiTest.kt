package xyz.klinik.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

/**
 * The assistant, as the patient's screen sees it.
 *
 * The client's job is small and one part of it matters: whichever way the
 * server went, there is something to show.
 */
class AssistantApiTest {
    @Test
    fun `reads an answer with its sources`() {
        val result = json.decodeFromString<AssistantResult>(
            """
            {"questionMessageId":"m1","answered":true,
             "answer":"Pansumanınızı günde bir kez değiştirin.",
             "sources":["Yara Bakımı"],"handoverReason":null}
            """.trimIndent(),
        )

        assertTrue(result.answered)
        assertEquals(listOf("Yara Bakımı"), result.sources)
        assertNull(result.handoverReason)
    }

    @Test
    fun `reads every handover reason the server can send`() {
        val reasons = mapOf(
            "no-sources" to HandoverReason.NO_SOURCES,
            "model-declined" to HandoverReason.MODEL_DECLINED,
            "no-citations" to HandoverReason.NO_CITATIONS,
            "ai-unavailable" to HandoverReason.AI_UNAVAILABLE,
        )

        for ((wire, expected) in reasons) {
            val result = json.decodeFromString<AssistantResult>(
                """{"questionMessageId":"m1","answered":false,"handoverReason":"$wire"}""",
            )

            assertEquals(expected, result.handoverReason)
            assertFalse(result.answered)
        }
    }

    /**
     * Every handover reads the same to the patient. Explaining which internal
     * check declined would invite rephrasing until the bot answers, which is
     * the opposite of what those checks are for.
     */
    @Test
    fun `every handover reason says the same thing to the patient`() {
        assertEquals(1, HandoverReason.entries.map { it.stringKey }.toSet().size)
    }

    @Test
    fun `keeps the question handle so it can be escalated`() {
        val result = json.decodeFromString<AssistantResult>(
            """{"questionMessageId":"m-42","answered":true,"answer":"Evet.","sources":["SSS"]}""",
        )

        assertEquals("m-42", result.questionMessageId)
    }
}
