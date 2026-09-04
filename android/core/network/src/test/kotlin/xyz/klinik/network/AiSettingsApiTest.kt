package xyz.klinik.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

/**
 * Choosing the AI provider (spec 3.4, 14.5).
 *
 * The two properties a settings screen must not blur: the key is write-only,
 * and "the provider works" is not "the provider may see patient data".
 */
class AiSettingsApiTest {
    private val configured = """
        {"provider":"anthropic","model":"claude-sonnet-5","apiKeyLast4":"1234","hasApiKey":true,
         "inputPricePerMTok":"3.00","outputPricePerMTok":"15.00",
         "zeroRetentionConfirmed":true,"monthlyBudgetUsd":"200.00","ready":true,"missing":[]}
    """.trimIndent()

    @Test
    fun `the key is only ever four characters`() {
        val settings = json.decodeFromString<AiSettings>(configured)

        assertTrue(settings.hasApiKey)
        assertEquals("1234", settings.apiKeyLast4)
    }

    /** A working key still refuses clinical prompts without the declaration. */
    @Test
    fun `ready to run is not ready for clinical work`() {
        val withDeclaration = json.decodeFromString<AiSettings>(configured)
        val without = json.decodeFromString<AiSettings>(
            """
            {"provider":"deepseek","model":"deepseek-chat","apiKeyLast4":"9999","hasApiKey":true,
             "inputPricePerMTok":"0.30","outputPricePerMTok":"1.20",
             "zeroRetentionConfirmed":false,"ready":true,"missing":[]}
            """.trimIndent(),
        )

        assertTrue(withDeclaration.readyForClinicalUse)
        assertTrue(without.ready)
        assertFalse(without.readyForClinicalUse)
    }

    @Test
    fun `turns the missing fields into resource keys`() {
        val partial = json.decodeFromString<AiSettings>(
            """
            {"provider":"gemini","hasApiKey":false,"zeroRetentionConfirmed":false,"ready":false,
             "missing":["model","apiKey","inputPricePerMTok","outputPricePerMTok"]}
            """.trimIndent(),
        )

        // These are the names the string generator produces from the iOS
        // catalogue keys, so a mismatch here is a missing translation at
        // runtime rather than a compile error.
        assertEquals(
            listOf(
                "ai_missing_model",
                "ai_missing_api_key",
                "ai_missing_input_price_per_mtok",
                "ai_missing_output_price_per_mtok",
            ),
            partial.missingStringKeys,
        )
    }

    @Test
    fun `an unconfigured layer reads as unconfigured`() {
        val empty = json.decodeFromString<AiSettings>("""{"missing":["provider"]}""")

        assertNull(empty.provider)
        assertFalse(empty.hasApiKey)
        assertFalse(empty.readyForClinicalUse)
    }

    @Test
    fun `reads all four providers with their warnings`() {
        val providers = json.decodeFromString<List<AiProviderInfo>>(
            """
            [{"id":"anthropic","label":"Anthropic (Claude)","models":["claude-sonnet-5"],
              "pricingUrl":"https://a","consoleUrl":"https://b","retentionNote":"n1"},
             {"id":"openai","label":"OpenAI","models":["gpt-5"],
              "pricingUrl":"https://a","consoleUrl":"https://b","retentionNote":"n2"},
             {"id":"gemini","label":"Google","models":["gemini-2.5-pro"],
              "pricingUrl":"https://a","consoleUrl":"https://b","retentionNote":"n3"},
             {"id":"deepseek","label":"DeepSeek","models":["deepseek-chat"],
              "pricingUrl":"https://a","consoleUrl":"https://b","retentionNote":"n4"}]
            """.trimIndent(),
        )

        assertEquals(AiProviderChoice.entries, providers.map { it.id })
        assertTrue(providers.all { it.retentionNote.isNotEmpty() })
    }

    @Test
    fun `a connection test reports the provider's own words`() {
        val failed = json.decodeFromString<AiConnectionTest>(
            """{"ok":false,"error":"API key not valid"}""",
        )
        val worked = json.decodeFromString<AiConnectionTest>(
            """{"ok":true,"model":"claude-sonnet-5-20260101"}""",
        )

        assertFalse(failed.ok)
        assertEquals("API key not valid", failed.error)
        assertEquals("claude-sonnet-5-20260101", worked.model)
        assertNull(worked.error)
    }
}
