package xyz.klinik.feature.documents

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import xyz.klinik.network.ApiError
import xyz.klinik.network.ClinicalDocument
import xyz.klinik.network.DocumentType
import xyz.klinik.network.DocumentsApi
import xyz.klinik.network.UiText
import xyz.klinik.network.messageKey
import xyz.klinik.network.uiText

sealed interface DocumentsPhase {
    data object Loading : DocumentsPhase
    data object Loaded : DocumentsPhase

    /** Nothing uploaded yet. Not a failure, and must not be shown as one. */
    data object Empty : DocumentsPhase

    /**
     * Absent, or outside this user's scope — the backend makes the two
     * indistinguishable on purpose.
     */
    data object NotFound : DocumentsPhase

    data class Failed(val messageKey: String) : DocumentsPhase
}

data class DocumentsState(
    val phase: DocumentsPhase = DocumentsPhase.Loading,
    val documents: List<ClinicalDocument> = emptyList(),
    val nextCursor: String? = null,
    val loadingMore: Boolean = false,
    val uploading: Boolean = false,
    val uploadError: UiText? = null,
) {
    val hasMore: Boolean get() = nextCursor != null

    /**
     * Whether anything is still being processed, so the screen knows whether
     * there is any point asking again.
     */
    val hasUnsettledWork: Boolean get() = documents.any { !it.ocrStatus.isSettled }
}

/** A patient's documents: the list, uploading, and watching processing finish. */
class DocumentsModel(
    private val api: DocumentsApi,
    private val patientId: String,
    private val pageSize: Int = 25,
) {
    private val _state = MutableStateFlow(DocumentsState())
    val state: StateFlow<DocumentsState> = _state.asStateFlow()

    /** Serialises uploads so a double tap cannot send the same scan twice. */
    private val uploadLock = Mutex()

    suspend fun load() {
        _state.value = _state.value.copy(
            phase = DocumentsPhase.Loading,
            documents = emptyList(),
            nextCursor = null,
        )
        fetchPage(null)
    }

    /**
     * The next page. Ignored while one is already in flight, so a fast scroll
     * does not request the same cursor twice and duplicate rows.
     */
    suspend fun loadMore() {
        val cursor = _state.value.nextCursor ?: return
        if (_state.value.loadingMore) return

        _state.value = _state.value.copy(loadingMore = true)
        fetchPage(cursor)
        _state.value = _state.value.copy(loadingMore = false)
    }

    /**
     * Uploads a file and reloads the list.
     *
     * Reloading rather than prepending what we sent: the server decides the
     * document's real type from the bytes, and a row showing what the client
     * guessed would disagree with the one beside it after the next refresh.
     */
    suspend fun upload(
        path: String,
        filename: String,
        type: DocumentType,
        contentType: String = "application/octet-stream",
    ): Boolean {
        if (!uploadLock.tryLock()) return false

        _state.value = _state.value.copy(uploading = true, uploadError = null)

        try {
            api.upload(patientId, path, filename, type, contentType)
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                uploading = false,
                // A refused upload is the type or size check doing its job, and
                // the server's message says which.
                uploadError = (error as? ApiError)?.uiText() ?: UiText.Key("error.server"),
            )
            return false
        } finally {
            uploadLock.unlock()
        }

        load()
        _state.value = _state.value.copy(uploading = false)
        return true
    }

    /**
     * Re-reads the first page to pick up processing that has finished.
     *
     * Polling, not pushing: live updates arrive with the message socket in a
     * later task, and until then a screen that never updates would leave a
     * document sitting at "waiting" long after it was done.
     */
    suspend fun refreshStatuses() {
        if (!_state.value.hasUnsettledWork) return

        val fresh = try {
            api.list(patientId, limit = pageSize).items
        } catch (error: Throwable) {
            // A failed poll is not worth interrupting the screen for: the list
            // on display is still correct, only slightly stale.
            return
        }

        val byId = fresh.associateBy { it.id }

        // Updated in place rather than replaced, so a poll landing mid-scroll
        // does not throw away pages already loaded.
        _state.value = _state.value.copy(
            documents = _state.value.documents.map { byId[it.id] ?: it },
        )
    }

    suspend fun remove(documentId: String) {
        try {
            api.remove(documentId)
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                uploadError = (error as? ApiError)?.uiText() ?: UiText.Key("error.server"),
            )
            return
        }

        val remaining = _state.value.documents.filterNot { it.id == documentId }

        _state.value = _state.value.copy(
            documents = remaining,
            phase = if (remaining.isEmpty()) DocumentsPhase.Empty else _state.value.phase,
        )
    }

    private suspend fun fetchPage(cursor: String?) {
        try {
            val page = api.list(patientId, cursor = cursor, limit = pageSize)
            val documents = _state.value.documents + page.items

            _state.value = _state.value.copy(
                documents = documents,
                nextCursor = page.nextCursor,
                phase = if (documents.isEmpty()) DocumentsPhase.Empty else DocumentsPhase.Loaded,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = if (error is ApiError.NotFound) {
                    DocumentsPhase.NotFound
                } else {
                    DocumentsPhase.Failed((error as? ApiError)?.messageKey() ?: "error.server")
                },
            )
        }
    }
}
