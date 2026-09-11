package xyz.klinik.feature.aisettings

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.AiProviderChoice
import xyz.klinik.network.AiSettingsApi
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object AiRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading AI settings must not refresh a session")
}

private class AiTransport(private val bodies: Map<String, Pair<Int, String>>) : HttpTransport {
    val sent = mutableListOf<Pair<String, String>>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        sent += "${request.method} $path" to request.body.orEmpty()

        val (status, body) = bodies["${request.method} $path"] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private const val PROVIDERS = """
    [{"id":"anthropic","label":"Anthropic","models":["claude-opus-5"],
      "pricingUrl":"https://x.test/p","consoleUrl":"https://x.test/c",
      "retentionNote":"Sıfır saklama için kurumsal sözleşme gerekir."},
     {"id":"openai","label":"OpenAI","models":["gpt-5"],
      "pricingUrl":"https://y.test/p","consoleUrl":"https://y.test/c",
      "retentionNote":"Sıfır saklama ayrı başvuru ister."}]
"""

private fun settings(
    provider: String? = "anthropic",
    confirmed: Boolean = true,
    last4: String? = "ab12",
) = """
    {${provider?.let { "\"provider\":\"$it\"," } ?: "\"provider\":null,"}
     "model":"claude-opus-5",
     ${last4?.let { "\"apiKeyLast4\":\"$it\"," } ?: "\"apiKeyLast4\":null,"}
     "hasApiKey":${last4 != null},
     "inputPricePerMTok":"5.00","outputPricePerMTok":"25.00",
     "zeroRetentionConfirmed":$confirmed,"zeroRetentionNote":null,
     "zeroRetentionAt":null,"monthlyBudgetUsd":"200.00",
     "ready":true,"missing":[],"updatedAt":"2026-09-12T08:00:00.000Z"}
""".trimIndent()

/**
 * Choosing which model service the clinic uses (spec 3.4, 14.5).
 *
 * Two rules, and both of them are about what must *not* happen: the key must
 * not survive in the form, and a zero-retention declaration must not follow
 * the clinic from one provider to another.
 */
class AiSettingsModelTest {
    private fun transport(vararg bodies: Pair<String, Pair<Int, String>>) =
        AiTransport(bodies.toMap())

    private suspend fun model(transport: AiTransport): AiSettingsModel {
        val session = SessionManager(InMemoryTokenStore(), AiRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return AiSettingsModel(
            AiSettingsApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
        )
    }

    private fun loaded() = transport(
        "GET ai/providers" to (200 to PROVIDERS),
        "GET ai/settings" to (200 to settings()),
        "PUT ai/settings" to (200 to settings()),
    )

    /**
     * The four services do not offer the same terms.
     *
     * A tick carried from one to another would record a statement the clinic
     * never made about the service it now uses.
     */
    @Test
    fun `switching provider drops the retention declaration`() = runTest {
        val subject = model(loaded())

        subject.load()
        assertTrue(subject.state.value.draft.zeroRetentionConfirmed)

        subject.choose(AiProviderChoice.OPENAI)

        assertFalse(subject.state.value.draft.zeroRetentionConfirmed)
        assertTrue(subject.state.value.retentionNeedsConfirming)
    }

    /** Choosing the provider already saved keeps what was already declared. */
    @Test
    fun `choosing the current provider again keeps the declaration`() = runTest {
        val subject = model(loaded())

        subject.load()
        subject.choose(AiProviderChoice.OPENAI)
        subject.choose(AiProviderChoice.ANTHROPIC)

        assertTrue(subject.state.value.draft.zeroRetentionConfirmed)
        assertFalse(subject.state.value.retentionNeedsConfirming)
    }

    /**
     * The key is typed once and never held.
     *
     * Nothing reads it back — no endpoint returns it — so a form that kept it
     * would be the only copy on the device.
     */
    @Test
    fun `the key leaves the form when it leaves the phone`() = runTest {
        val transport = loaded()
        val subject = model(transport)

        subject.load()
        subject.edit { copy(apiKey = "sk-test-value") }
        subject.save()

        assertEquals("", subject.state.value.draft.apiKey)
        assertTrue(transport.sent.last().second.contains("sk-test-value"))
    }

    /**
     * An untouched key box leaves the stored key alone.
     *
     * Sending an empty string would clear it, and "I changed the price" is not
     * "I removed the key".
     */
    @Test
    fun `saving without typing a key does not send one`() = runTest {
        val transport = loaded()
        val subject = model(transport)

        subject.load()
        subject.edit { copy(inputPrice = "6.00") }
        subject.save()

        val body = transport.sent.last().second

        assertTrue("\"apiKey\":null" in body || "apiKey" !in body, body)
        assertTrue("6.00" in body, body)
    }

    /** The four characters that answer the only question a screen has. */
    @Test
    fun `what comes back is the last four characters and not the key`() = runTest {
        val subject = model(loaded())

        subject.load()

        assertEquals("ab12", subject.state.value.settings?.apiKeyLast4)
        assertTrue(subject.state.value.settings?.hasApiKey == true)
    }

    /** Clearing forgets the configuration and empties the form with it. */
    @Test
    fun `clearing empties the form as well as the server`() = runTest {
        val subject = model(
            transport(
                "GET ai/providers" to (200 to PROVIDERS),
                "GET ai/settings" to (200 to settings()),
                "DELETE ai/settings" to (
                    200 to settings(provider = null, confirmed = false, last4 = null)
                    ),
            ),
        )

        subject.load()
        assertTrue(subject.clear())

        assertEquals(AiSettingsDraft(), subject.state.value.draft)
        assertEquals(null, subject.state.value.settings?.provider)
    }

    /** No `admin.write` is a permission answer, not a broken screen. */
    @Test
    fun `a forbidden account is told so rather than shown an error`() = runTest {
        val subject = model(
            transport(
                "GET ai/providers" to (403 to """{"message":"forbidden"}"""),
                "GET ai/settings" to (403 to """{"message":"forbidden"}"""),
            ),
        )

        subject.load()

        assertEquals(AiSettingsPhase.NotPermitted, subject.state.value.phase)
    }

    @Test
    fun `a connection test reports what answered`() = runTest {
        val subject = model(
            transport(
                "GET ai/providers" to (200 to PROVIDERS),
                "GET ai/settings" to (200 to settings()),
                "POST ai/settings/test" to (
                    200 to """{"ok":true,"model":"claude-opus-5-20260801","error":null}"""
                    ),
            ),
        )

        subject.load()
        subject.test()

        val result = subject.state.value.testResult

        assertNotNull(result)
        assertTrue(result.ok)
        // The version that actually answered, not the one asked for.
        assertEquals("claude-opus-5-20260801", result.model)
    }
}
