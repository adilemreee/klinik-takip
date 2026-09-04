package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Choosing which model service the clinic uses (spec 3.4, 14.5).
 *
 * Two things this is built to make hard to get wrong on a screen.
 *
 * The **key is write-only**. There is no field to read it back, because no
 * endpoint returns it — a screen sees the last four characters, which answers
 * the only question it has: which key is in there.
 *
 * The **zero-retention declaration belongs to a provider**. The four services
 * do not offer the same terms, so switching provider clears it and the clinic
 * has to say it again. A screen that hid that would be collecting consent
 * nobody gave.
 */

@Serializable
enum class AiProviderChoice {
    @kotlinx.serialization.SerialName("anthropic")
    ANTHROPIC,

    @kotlinx.serialization.SerialName("openai")
    OPENAI,

    @kotlinx.serialization.SerialName("gemini")
    GEMINI,

    @kotlinx.serialization.SerialName("deepseek")
    DEEPSEEK,
}

@Serializable
data class AiProviderInfo(
    val id: AiProviderChoice,
    val label: String,
    /** Suggested models. Not a closed list. */
    val models: List<String> = emptyList(),
    /** Where the operator reads the current price. */
    val pricingUrl: String,
    /** Where the operator gets a key. */
    val consoleUrl: String,
    /**
     * What has to be satisfied before clinical prompts are allowed. Shown
     * beside the confirmation box, not behind a link: a tick against an unread
     * sentence is not a record of anything.
     */
    val retentionNote: String,
)

@Serializable
data class AiSettings(
    val provider: AiProviderChoice? = null,
    val model: String? = null,
    /** The last four characters. The key itself never leaves the server. */
    val apiKeyLast4: String? = null,
    val hasApiKey: Boolean = false,
    val inputPricePerMTok: String? = null,
    val outputPricePerMTok: String? = null,
    /** Applies to `provider`. Cleared whenever the provider changes. */
    val zeroRetentionConfirmed: Boolean = false,
    val zeroRetentionNote: String? = null,
    val zeroRetentionAt: String? = null,
    val monthlyBudgetUsd: String? = null,
    /** Whether the AI layer would run with what is saved. */
    val ready: Boolean = false,
    /** What is missing, in the order somebody would fix it. */
    val missing: List<String> = emptyList(),
    val updatedAt: String? = null,
) {
    /**
     * Ready to run is not ready for clinical work.
     *
     * Without the declaration the layer still refuses every clinical prompt, so
     * a screen showing only `ready` would tell an administrator they had
     * finished while the interesting half of the system was still off.
     */
    val readyForClinicalUse: Boolean get() = ready && zeroRetentionConfirmed

    val missingStringKeys: List<String> get() = missing.map { "ai_missing_${it.toSnake()}" }
}

private fun String.toSnake(): String =
    replace(Regex("([a-z0-9])([A-Z])"), "$1_$2").lowercase()

@Serializable
data class AiConnectionTest(
    val ok: Boolean = false,
    /** The version that actually answered, not always the one asked for. */
    val model: String? = null,
    /** The provider's own words, truncated. */
    val error: String? = null,
)

@Serializable
private data class UpdateAiSettingsBody(
    val provider: AiProviderChoice? = null,
    val model: String? = null,
    val apiKey: String? = null,
    val inputPricePerMTok: String? = null,
    val outputPricePerMTok: String? = null,
    val monthlyBudgetUsd: String? = null,
    val zeroRetentionConfirmed: Boolean? = null,
    val zeroRetentionNote: String? = null,
)

class AiSettingsApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /** The four on offer, with where to get a key and what to check about each. */
    suspend fun providers(): List<AiProviderInfo> =
        decode(client.send(Endpoint(HttpMethod.GET, "ai/providers")))

    suspend fun settings(): AiSettings =
        decode(client.send(Endpoint(HttpMethod.GET, "ai/settings")))

    /**
     * Saves the choice. `apiKey` is write-only — omit it to leave the stored key
     * alone, which is what changing a price should do.
     */
    suspend fun update(
        provider: AiProviderChoice? = null,
        model: String? = null,
        apiKey: String? = null,
        inputPricePerMTok: String? = null,
        outputPricePerMTok: String? = null,
        monthlyBudgetUsd: String? = null,
        zeroRetentionConfirmed: Boolean? = null,
        zeroRetentionNote: String? = null,
    ): AiSettings =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.PUT,
                    "ai/settings",
                    body = json.encodeToString(
                        UpdateAiSettingsBody.serializer(),
                        UpdateAiSettingsBody(
                            provider, model, apiKey, inputPricePerMTok,
                            outputPricePerMTok, monthlyBudgetUsd,
                            zeroRetentionConfirmed, zeroRetentionNote,
                        ),
                    ),
                ),
            ),
        )

    /** Switches the AI layer off by forgetting the configuration. */
    suspend fun clear(): AiSettings =
        decode(client.send(Endpoint(HttpMethod.DELETE, "ai/settings")))

    /** Checks the saved key against the provider. Sends nothing clinical. */
    suspend fun test(): AiConnectionTest =
        decode(client.send(Endpoint(HttpMethod.POST, "ai/settings/test")))

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
