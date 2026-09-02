package xyz.klinik.feature.messaging

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import xyz.klinik.network.ApiError
import xyz.klinik.network.ChatMessage
import xyz.klinik.network.ClinicState
import xyz.klinik.network.Conversation
import xyz.klinik.network.MessageType
import xyz.klinik.network.MessagingApi
import xyz.klinik.network.QuickReply
import xyz.klinik.network.UiText
import xyz.klinik.network.messageKey
import xyz.klinik.network.uiText

sealed interface ChatPhase {
    data object Loading : ChatPhase
    data object Loaded : ChatPhase

    /** No messages yet. Not a failure. */
    data object Empty : ChatPhase

    data object NotFound : ChatPhase
    data class Failed(val messageKey: String) : ChatPhase
}

data class ChatState(
    val phase: ChatPhase = ChatPhase.Loading,
    val conversationId: String? = null,
    /** Oldest first, ready to render. */
    val messages: List<ChatMessage> = emptyList(),
    val olderCursor: String? = null,
    /** Whether the clinic is reachable, and when it next will be. */
    val clinic: ClinicState? = null,
    val quickReplies: List<QuickReply> = emptyList(),
    val sending: Boolean = false,
    val error: UiText? = null,
    /** Who is typing, other than the caller. */
    val typing: Set<String> = emptySet(),
) {
    val hasOlder: Boolean get() = olderCursor != null

    /** True when what the patient writes now will be held rather than sent. */
    val willBeQueued: Boolean get() = clinic?.open == false
}

/**
 * One conversation (spec M3).
 *
 * Messages are sent over REST and *announced* over the socket. A socket that
 * drops mid-send would leave the client unsure whether the message exists; a
 * POST either returns an id or does not.
 */
class ChatModel(
    private val api: MessagingApi,
    private val conversation: suspend () -> Conversation,
) {
    private val _state = MutableStateFlow(ChatState())
    val state: StateFlow<ChatState> = _state.asStateFlow()

    private val sendLock = Mutex()

    suspend fun load() {
        _state.value = _state.value.copy(phase = ChatPhase.Loading)

        try {
            val conversation = conversation()

            coroutineScope {
                // Asked together: the compose box has to know whether the clinic
                // is open before the patient starts writing, not after they send.
                val page = async { api.messages(conversation.id) }
                val clinic = async { api.clinicState() }

                val loaded = page.await()

                _state.value = _state.value.copy(
                    conversationId = conversation.id,
                    messages = loaded.items,
                    olderCursor = loaded.nextCursor,
                    clinic = clinic.await(),
                    phase = if (loaded.items.isEmpty()) ChatPhase.Empty else ChatPhase.Loaded,
                )
            }
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = if (error is ApiError.NotFound) {
                    ChatPhase.NotFound
                } else {
                    ChatPhase.Failed((error as? ApiError)?.messageKey() ?: "error.server")
                },
            )
        }
    }

    /** Older messages, prepended. The cursor walks backwards through history. */
    suspend fun loadOlder() {
        val conversationId = _state.value.conversationId ?: return
        val cursor = _state.value.olderCursor ?: return

        val page = try {
            api.messages(conversationId, cursor)
        } catch (error: Throwable) {
            // A failed page is not worth interrupting the conversation for;
            // what is on screen is still correct.
            return
        }

        _state.value = _state.value.copy(
            messages = page.items + _state.value.messages,
            olderCursor = page.nextCursor,
        )
    }

    suspend fun send(body: String, mediaKey: String? = null): Boolean {
        val conversationId = _state.value.conversationId ?: return false
        val trimmed = body.trim()

        if (trimmed.isEmpty() && mediaKey == null) return false
        if (!sendLock.tryLock()) return false

        _state.value = _state.value.copy(sending = true, error = null)

        val sent = try {
            api.send(
                conversationId,
                trimmed.ifEmpty { null },
                mediaKey,
                if (mediaKey != null) MessageType.FILE else null,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                sending = false,
                error = (error as? ApiError)?.uiText() ?: UiText.Key("error.server"),
            )
            return false
        } finally {
            sendLock.unlock()
        }

        // Appended from the server's answer, including its queued status, so the
        // row on screen says the same thing the clinic will see.
        append(sent.message)
        _state.value = _state.value.copy(sending = false)
        return true
    }

    /** A message that arrived over the socket. */
    fun receive(message: ChatMessage) {
        if (message.conversationId != _state.value.conversationId) return

        append(message)

        message.senderId?.let { sender ->
            _state.value = _state.value.copy(typing = _state.value.typing - sender)
        }
    }

    fun setTyping(userId: String, isTyping: Boolean) {
        _state.value = _state.value.copy(
            typing = if (isTyping) _state.value.typing + userId else _state.value.typing - userId,
        )
    }

    suspend fun markRead() {
        val conversationId = _state.value.conversationId ?: return
        runCatching { api.markRead(conversationId) }
    }

    suspend fun loadQuickReplies() {
        _state.value = _state.value.copy(
            quickReplies = runCatching { api.quickReplies() }.getOrDefault(emptyList()),
        )
    }

    /**
     * Appends, or replaces an existing row.
     *
     * The sender receives its own message twice — once from the POST and once
     * over the socket — and a chat that showed both would be a chat nobody
     * trusted.
     */
    private fun append(message: ChatMessage) {
        val existing = _state.value.messages.indexOfFirst { it.id == message.id }

        val messages = if (existing >= 0) {
            _state.value.messages.toMutableList().also { it[existing] = message }
        } else {
            _state.value.messages + message
        }

        _state.value = _state.value.copy(messages = messages, phase = ChatPhase.Loaded)
    }
}
