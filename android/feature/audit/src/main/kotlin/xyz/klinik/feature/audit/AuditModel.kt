package xyz.klinik.feature.audit

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.AuditAction
import xyz.klinik.network.AuditAnomaly
import xyz.klinik.network.AuditApi
import xyz.klinik.network.AuditEntry
import xyz.klinik.network.AuditFilter
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface AuditPhase {
    data object Loading : AuditPhase
    data object Loaded : AuditPhase

    /** Nothing matched the filter. Not a failure, and not an empty log. */
    data object Empty : AuditPhase

    /** Not a failure: reading the log needs `audit.read`. */
    data object NotPermitted : AuditPhase
    data class Failed(val message: UiText) : AuditPhase
}

data class AuditState(
    val phase: AuditPhase = AuditPhase.Loading,
    val entries: List<AuditEntry> = emptyList(),
    val anomalies: List<AuditAnomaly> = emptyList(),
    val action: AuditAction? = null,
    val nextCursor: String? = null,
    val error: UiText? = null,
) {
    val hasMore: Boolean get() = nextCursor != null
}

/**
 * Who did what to whose record (spec M13).
 *
 * The log is the thing that makes the rest of the clinic answerable, so this
 * model's whole job is to lose none of it: the page is appended rather than
 * replaced, nothing is filtered on the client, and an anomaly the server
 * flagged is carried in the server's own words.
 *
 * The anomalies are fetched beside the log rather than on their own screen.
 * They are the reason somebody opens this: "a nurse read a hundred and twenty
 * files last night" is not a row anybody would find by scrolling.
 */
class AuditModel(private val api: AuditApi) {
    private val _state = MutableStateFlow(AuditState())
    val state: StateFlow<AuditState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = AuditPhase.Loading)

        try {
            val page = api.entries(AuditFilter(action = _state.value.action))
            // Its own call, and allowed to fail on its own: a clinic that can
            // read the log should still get it when the detector is down.
            val anomalies = runCatching { api.anomalies() }.getOrDefault(emptyList())

            _state.value = _state.value.copy(
                phase = if (page.items.isEmpty()) AuditPhase.Empty else AuditPhase.Loaded,
                entries = page.items,
                anomalies = anomalies,
                nextCursor = page.nextCursor,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = if (error is ApiError.Forbidden) {
                    AuditPhase.NotPermitted
                } else {
                    AuditPhase.Failed(messageFor(error))
                },
            )
        }
    }

    suspend fun choose(action: AuditAction?) {
        _state.value = _state.value.copy(action = action, entries = emptyList(), nextCursor = null)
        load()
    }

    suspend fun loadMore() {
        val cursor = _state.value.nextCursor ?: return

        val page = runCatching {
            api.entries(AuditFilter(action = _state.value.action, cursor = cursor))
        }.getOrNull() ?: return

        _state.value = _state.value.copy(
            entries = _state.value.entries + page.items,
            nextCursor = page.nextCursor,
        )
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
