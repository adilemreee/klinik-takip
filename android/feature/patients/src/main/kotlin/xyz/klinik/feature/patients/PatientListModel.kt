package xyz.klinik.feature.patients

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import xyz.klinik.network.ApiError
import xyz.klinik.network.Patient
import xyz.klinik.network.PatientSearch
import xyz.klinik.network.PatientsApi
import xyz.klinik.network.messageKey

/**
 * What the list is showing right now.
 *
 * Empty and failed are separate because the screen says different things:
 * "no patients match" invites changing the search, "you are offline" invites
 * waiting (spec section 7 asks for both to be designed).
 */
sealed interface ListPhase {
    data object Idle : ListPhase
    data object LoadingFirstPage : ListPhase
    data object Loaded : ListPhase
    data object Empty : ListPhase
    data class Failed(val messageKey: String) : ListPhase
}

data class PatientListState(
    val phase: ListPhase = ListPhase.Idle,
    val patients: List<Patient> = emptyList(),
    /** True while a further page is on its way, so the footer can show it
     *  without the whole list flashing a spinner. */
    val isLoadingMore: Boolean = false,
    val hasMore: Boolean = false,
    val query: String = "",
)

/** Drives the staff-side patient list: search, paging and the states between. */
class PatientListModel(
    private val api: PatientsApi,
    private val pageSize: Int = 25,
) {
    private val _state = MutableStateFlow(PatientListState())
    val state: StateFlow<PatientListState> = _state.asStateFlow()

    private var cursor: String? = null

    /**
     * Increments on every new search. A response whose generation is stale is
     * dropped rather than applied.
     */
    private var generation = 0

    /** Starts again from the first page: on appear, and on every search change. */
    suspend fun search(query: String) {
        generation += 1
        val thisGeneration = generation

        cursor = null
        _state.update {
            it.copy(query = query, phase = ListPhase.LoadingFirstPage, isLoadingMore = false)
        }

        try {
            val page = api.search(PatientSearch(query = query, limit = pageSize))

            // A slower response for an earlier query must not overwrite a newer
            // one. Typing "Zim" then "Zimm" sends two requests, and the network
            // does not promise they come back in order.
            if (thisGeneration != generation) return

            cursor = page.nextCursor
            _state.update {
                it.copy(
                    patients = page.items,
                    hasMore = page.nextCursor != null,
                    phase = if (page.items.isEmpty()) ListPhase.Empty else ListPhase.Loaded,
                )
            }
        } catch (error: Throwable) {
            if (thisGeneration != generation) return

            _state.update {
                it.copy(
                    patients = emptyList(),
                    hasMore = false,
                    phase = ListPhase.Failed((error as? ApiError)?.messageKey() ?: "error.server"),
                )
            }
        }
    }

    /**
     * Appends the next page. Safe to call repeatedly from a scroll handler: it
     * does nothing while a page is loading or once the end has been reached.
     */
    suspend fun loadMore() {
        val current = _state.value
        val nextCursor = cursor

        if (!current.hasMore || current.isLoadingMore || nextCursor == null) return

        val thisGeneration = generation
        _state.update { it.copy(isLoadingMore = true) }

        try {
            val page = api.search(
                PatientSearch(query = current.query, cursor = nextCursor, limit = pageSize),
            )

            // A page arriving after the user started a new search belongs to a
            // list that no longer exists.
            if (thisGeneration != generation) return

            cursor = page.nextCursor
            _state.update {
                it.copy(
                    patients = it.patients + page.items,
                    hasMore = page.nextCursor != null,
                    isLoadingMore = false,
                )
            }
        } catch (error: Throwable) {
            if (thisGeneration != generation) return

            // The pages already on screen stay: losing them because page three
            // failed would be worse than showing what we have.
            _state.update { it.copy(isLoadingMore = false) }
        }
    }

    suspend fun retry() {
        search(_state.value.query)
    }
}
