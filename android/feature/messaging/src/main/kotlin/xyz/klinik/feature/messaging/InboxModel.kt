package xyz.klinik.feature.messaging

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.InboxEntry
import xyz.klinik.network.MessagingApi
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface InboxPhase {
    data object Loading : InboxPhase
    data object Loaded : InboxPhase

    /** Nothing open. A finished inbox, not a failure. */
    data object Empty : InboxPhase

    /** Not a failure: the inbox needs `messages.read`. */
    data object NotPermitted : InboxPhase
    data class Failed(val message: UiText) : InboxPhase
}

data class InboxState(
    val phase: InboxPhase = InboxPhase.Loading,
    /** The server's order: most recent first. */
    val entries: List<InboxEntry> = emptyList(),
) {
    /**
     * The ones waiting on the clinic.
     *
     * Its own list because it is the question somebody opens an inbox to
     * answer. The rest stay below rather than being hidden — a conversation
     * with no unread message is still one somebody may need to find.
     */
    val unread: List<InboxEntry> get() = entries.filter { it.hasUnread }

    val read: List<InboxEntry> get() = entries.filterNot { it.hasUnread }

    val unreadCount: Int get() = unread.sumOf { it.unread }
}

/**
 * The clinic's conversations (spec M6).
 *
 * The order is the server's — most recent first — and nothing is dropped on
 * this side. What the model adds is the split a reader needs: which
 * conversations are waiting on the clinic, and which are merely open.
 */
class InboxModel(private val api: MessagingApi) {
    private val _state = MutableStateFlow(InboxState())
    val state: StateFlow<InboxState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = InboxPhase.Loading)

        try {
            val entries = api.inbox()

            _state.value = InboxState(
                phase = if (entries.isEmpty()) InboxPhase.Empty else InboxPhase.Loaded,
                entries = entries,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = if (error is ApiError.Forbidden) {
                    InboxPhase.NotPermitted
                } else {
                    InboxPhase.Failed(messageFor(error))
                },
            )
        }
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
