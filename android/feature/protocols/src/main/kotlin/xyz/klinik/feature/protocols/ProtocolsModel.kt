package xyz.klinik.feature.protocols

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.ProtocolSummary
import xyz.klinik.network.ProtocolsApi
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface ProtocolsPhase {
    data object Loading : ProtocolsPhase
    data object Loaded : ProtocolsPhase

    /** No documents. The assistant answers nothing and sends everything on. */
    data object Empty : ProtocolsPhase

    /** Not a failure: managing the assistant's sources needs `admin.write`. */
    data object NotPermitted : ProtocolsPhase
    data class Failed(val message: UiText) : ProtocolsPhase
}

data class ProtocolsState(
    val phase: ProtocolsPhase = ProtocolsPhase.Loading,
    val documents: List<ProtocolSummary> = emptyList(),
    val showRetired: Boolean = false,
    val busy: Boolean = false,
    val error: UiText? = null,
) {
    private val visible: List<ProtocolSummary>
        get() = if (showRetired) documents else documents.filter { it.document.isActive }

    /** What the assistant can actually retrieve. */
    val usable: List<ProtocolSummary> get() = visible.filter { it.isUsable }

    /**
     * Accepted and unreachable.
     *
     * Its own list rather than a badge in the first one: a document the
     * assistant cannot see is, for the clinic's purposes, a document that was
     * never uploaded — and it looks identical to one that works.
     */
    val unusable: List<ProtocolSummary> get() = visible.filterNot { it.isUsable }
}

/** Why an upload was refused before it was sent. */
sealed interface ProtocolDraftProblem {
    data object NoTitle : ProtocolDraftProblem
    data object TooShort : ProtocolDraftProblem

    val stringKey: String
        get() = when (this) {
            NoTitle -> "protocol.needTitle"
            TooShort -> "protocol.needContent"
        }
}

/**
 * What the assistant is allowed to answer from (spec M4).
 *
 * The assistant answers only from these documents and hands everything else to
 * a person, so this list is the whole of what it knows. Two things follow.
 * A clinic with no documents is told that its assistant will forward every
 * question rather than being shown an empty list. And a document the server
 * stored but could not index is kept apart, because it is indistinguishable
 * from a working one and the assistant has never read it.
 */
class ProtocolsModel(private val api: ProtocolsApi) {
    private val _state = MutableStateFlow(ProtocolsState())
    val state: StateFlow<ProtocolsState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = ProtocolsPhase.Loading)

        try {
            val documents = api.all().sortedByDescending { it.document.createdAt }

            _state.value = _state.value.copy(
                phase = if (documents.isEmpty()) ProtocolsPhase.Empty else ProtocolsPhase.Loaded,
                documents = documents,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = if (error is ApiError.Forbidden) {
                    ProtocolsPhase.NotPermitted
                } else {
                    ProtocolsPhase.Failed(messageFor(error))
                },
            )
        }
    }

    fun showRetired(show: Boolean) {
        _state.value = _state.value.copy(showRetired = show)
    }

    /**
     * Refuses a document too short to be worth retrieving.
     *
     * A two-word protocol still embeds, and the assistant will cite it — so
     * the check is here, before the upload, rather than as a surprise in an
     * answer to a patient.
     */
    fun check(title: String, content: String): ProtocolDraftProblem? = when {
        title.isBlank() -> ProtocolDraftProblem.NoTitle
        content.trim().length < 80 -> ProtocolDraftProblem.TooShort
        else -> null
    }

    suspend fun upload(
        title: String,
        content: String,
        procedureType: String?,
        language: String = "tr",
    ): Boolean {
        check(title, content)?.let { problem ->
            _state.value = _state.value.copy(error = UiText.Key(problem.stringKey))
            return false
        }

        _state.value = _state.value.copy(busy = true, error = null)

        return try {
            val added = api.upload(title.trim(), content.trim(), procedureType?.ifBlank { null }, language)

            _state.value = _state.value.copy(
                phase = ProtocolsPhase.Loaded,
                documents = listOf(added) + _state.value.documents,
                busy = false,
            )

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busy = false, error = messageFor(error))
            false
        }
    }

    /** Withdraws one, so the assistant stops answering from it. */
    suspend fun retire(documentId: String): Boolean {
        _state.value = _state.value.copy(busy = true, error = null)

        return try {
            api.remove(documentId)

            val remaining = _state.value.documents.filterNot { it.document.id == documentId }

            _state.value = _state.value.copy(
                phase = if (remaining.isEmpty()) ProtocolsPhase.Empty else ProtocolsPhase.Loaded,
                documents = remaining,
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
