package xyz.klinik.feature.aisettings

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.AiConnectionTest
import xyz.klinik.network.AiProviderChoice
import xyz.klinik.network.AiProviderInfo
import xyz.klinik.network.AiSettings
import xyz.klinik.network.AiSettingsApi
import xyz.klinik.network.ApiError
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface AiSettingsPhase {
    data object Loading : AiSettingsPhase
    data object Loaded : AiSettingsPhase

    /** Not a failure: configuring the AI layer needs `admin.write`. */
    data object NotPermitted : AiSettingsPhase
    data class Failed(val message: UiText) : AiSettingsPhase
}

/** What the form holds before it is saved. */
data class AiSettingsDraft(
    val provider: AiProviderChoice? = null,
    val model: String = "",
    /** Typed once and sent once. Never read back, because nothing returns it. */
    val apiKey: String = "",
    val inputPrice: String = "",
    val outputPrice: String = "",
    val budget: String = "",
    val zeroRetentionConfirmed: Boolean = false,
)

data class AiSettingsState(
    val phase: AiSettingsPhase = AiSettingsPhase.Loading,
    val providers: List<AiProviderInfo> = emptyList(),
    val settings: AiSettings? = null,
    val draft: AiSettingsDraft = AiSettingsDraft(),
    val busy: Boolean = false,
    val testResult: AiConnectionTest? = null,
    val error: UiText? = null,
) {
    val chosenProvider: AiProviderInfo?
        get() = providers.firstOrNull { it.id == draft.provider }

    /**
     * Whether switching provider has dropped the clinic's declaration.
     *
     * The four services do not offer the same terms, so a confirmation given
     * about one is not a confirmation about another. A screen that carried it
     * across would be recording consent nobody gave.
     */
    val retentionNeedsConfirming: Boolean
        get() = draft.provider != null &&
            draft.provider != settings?.provider &&
            !draft.zeroRetentionConfirmed

    /** Nothing to send is not the same as nothing changed; this is the former. */
    val canSave: Boolean
        get() = draft.provider != null && !busy
}

/**
 * Choosing which model service the clinic uses (spec 3.4, 14.5).
 *
 * Two rules this model exists to keep.
 *
 * The key is write-only. It is typed, sent, and never held — the form clears
 * it after a save, and what comes back is four characters that answer the only
 * question a screen has: which key is in there.
 *
 * The zero-retention declaration belongs to a provider. Changing provider
 * clears it on the server, and the draft does not carry it across, so the
 * clinic has to say it again about the service it just chose.
 */
class AiSettingsModel(private val api: AiSettingsApi) {
    private val _state = MutableStateFlow(AiSettingsState())
    val state: StateFlow<AiSettingsState> = _state.asStateFlow()

    suspend fun load() {
        try {
            val providers = runCatching { api.providers() }.getOrNull()
            val settings = api.settings()

            _state.value = AiSettingsState(
                phase = AiSettingsPhase.Loaded,
                providers = providers.orEmpty(),
                settings = settings,
                draft = AiSettingsDraft(
                    provider = settings.provider,
                    model = settings.model.orEmpty(),
                    inputPrice = settings.inputPricePerMTok.orEmpty(),
                    outputPrice = settings.outputPricePerMTok.orEmpty(),
                    budget = settings.monthlyBudgetUsd.orEmpty(),
                    zeroRetentionConfirmed = settings.zeroRetentionConfirmed,
                ),
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = if ((error as? ApiError) is ApiError.Forbidden) {
                    AiSettingsPhase.NotPermitted
                } else {
                    AiSettingsPhase.Failed(messageFor(error))
                },
            )
        }
    }

    fun edit(change: AiSettingsDraft.() -> AiSettingsDraft) {
        _state.value = _state.value.copy(draft = _state.value.draft.change())
    }

    /**
     * Switching provider drops the declaration with it.
     *
     * Not a convenience: the terms differ between the four, and carrying a
     * tick from one to another would record a statement the clinic never made
     * about the service it now uses.
     */
    fun choose(provider: AiProviderChoice) {
        _state.value = _state.value.copy(
            draft = _state.value.draft.copy(
                provider = provider,
                zeroRetentionConfirmed = provider == _state.value.settings?.provider &&
                    _state.value.settings?.zeroRetentionConfirmed == true,
            ),
            testResult = null,
        )
    }

    suspend fun save(): Boolean {
        val draft = _state.value.draft

        _state.value = _state.value.copy(busy = true, error = null, testResult = null)

        return try {
            val saved = api.update(
                provider = draft.provider,
                model = draft.model.ifBlank { null },
                // Omitted rather than sent empty: an empty string would clear
                // the stored key, which is not what changing a price means.
                apiKey = draft.apiKey.ifBlank { null },
                inputPricePerMTok = draft.inputPrice.ifBlank { null },
                outputPricePerMTok = draft.outputPrice.ifBlank { null },
                monthlyBudgetUsd = draft.budget.ifBlank { null },
                zeroRetentionConfirmed = draft.zeroRetentionConfirmed,
            )

            _state.value = _state.value.copy(
                settings = saved,
                // The key leaves the form as soon as it leaves the phone.
                draft = draft.copy(apiKey = "", zeroRetentionConfirmed = saved.zeroRetentionConfirmed),
                busy = false,
            )

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busy = false, error = messageFor(error))
            false
        }
    }

    /** Checks the saved key against the provider. Sends nothing clinical. */
    suspend fun test() {
        _state.value = _state.value.copy(busy = true, error = null, testResult = null)

        try {
            _state.value = _state.value.copy(busy = false, testResult = api.test())
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busy = false, error = messageFor(error))
        }
    }

    /** Switches the AI layer off by forgetting the configuration. */
    suspend fun clear(): Boolean {
        _state.value = _state.value.copy(busy = true, error = null, testResult = null)

        return try {
            val cleared = api.clear()

            _state.value = _state.value.copy(
                settings = cleared,
                draft = AiSettingsDraft(),
                busy = false,
            )

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busy = false, error = messageFor(error))
            false
        }
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
