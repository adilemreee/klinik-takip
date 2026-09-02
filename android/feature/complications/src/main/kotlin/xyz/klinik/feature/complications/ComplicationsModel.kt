package xyz.klinik.feature.complications

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import xyz.klinik.network.ApiError
import xyz.klinik.network.ComplicationView
import xyz.klinik.network.ComplicationsApi
import xyz.klinik.network.UiText
import xyz.klinik.network.messageKey
import xyz.klinik.network.uiText

sealed interface ComplicationsPhase {
    data object Loading : ComplicationsPhase
    data object Loaded : ComplicationsPhase

    /** Nothing waiting, or nothing reported. The good state. */
    data object Empty : ComplicationsPhase

    data object NotFound : ComplicationsPhase
    data class Failed(val messageKey: String) : ComplicationsPhase
}

data class ComplicationsState(
    val phase: ComplicationsPhase = ComplicationsPhase.Loading,
    val items: List<ComplicationView> = emptyList(),
    /** The report currently being acted on, so its buttons can be disabled. */
    val working: String? = null,
    val submitting: Boolean = false,
    val error: UiText? = null,
) {
    /**
     * How many have been waiting past the clinic threshold — the number that
     * makes someone open this screen.
     */
    val overdueCount: Int get() = items.count { it.overdue }
}

/** The clinician's queue of reports still waiting (spec M7). */
class ComplicationQueueModel(private val api: ComplicationsApi) {
    private val _state = MutableStateFlow(ComplicationsState())
    val state: StateFlow<ComplicationsState> = _state.asStateFlow()

    private val lock = Mutex()

    suspend fun load(includeResolved: Boolean = false) {
        _state.value = _state.value.copy(phase = ComplicationsPhase.Loading)

        try {
            val items = api.queue(includeResolved)

            _state.value = _state.value.copy(
                items = items,
                phase = if (items.isEmpty()) ComplicationsPhase.Empty else ComplicationsPhase.Loaded,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(phase = failure(error))
        }
    }

    suspend fun acknowledge(id: String, message: String): Boolean =
        act(id) { api.acknowledge(id, message) }

    suspend fun resolve(id: String, message: String): Boolean =
        act(id) { api.resolve(id, message) }

    /**
     * Replaces the row in place with what the server returned.
     *
     * Not removed: a report that has just been answered is still the
     * clinician's to close, and taking it off the screen the moment they
     * replied would make them go looking for it again.
     */
    private suspend fun act(id: String, work: suspend () -> ComplicationView): Boolean {
        if (!lock.tryLock()) return false

        _state.value = _state.value.copy(working = id, error = null)

        val updated = try {
            work()
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                working = null,
                error = (error as? ApiError)?.uiText() ?: UiText.Key("error.server"),
            )
            return false
        } finally {
            lock.unlock()
        }

        _state.value = _state.value.copy(
            items = _state.value.items.map { if (it.complication.id == id) updated else it },
            working = null,
        )

        return true
    }
}

/** The patient's side: reporting, and seeing what the clinic said back. */
class MyComplicationsModel(private val api: ComplicationsApi) {
    private val _state = MutableStateFlow(ComplicationsState())
    val state: StateFlow<ComplicationsState> = _state.asStateFlow()

    private val submitLock = Mutex()

    suspend fun load() {
        _state.value = _state.value.copy(phase = ComplicationsPhase.Loading)

        try {
            val items = api.mine()

            _state.value = _state.value.copy(
                items = items,
                phase = if (items.isEmpty()) ComplicationsPhase.Empty else ComplicationsPhase.Loaded,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(phase = failure(error))
        }
    }

    suspend fun report(note: String, bodyArea: String? = null, photoIds: List<String> = emptyList()): Boolean {
        if (!submitLock.tryLock()) return false

        _state.value = _state.value.copy(submitting = true, error = null)

        try {
            api.report(note, bodyArea, photoIds)
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                submitting = false,
                error = (error as? ApiError)?.uiText() ?: UiText.Key("error.server"),
            )
            return false
        } finally {
            submitLock.unlock()
        }

        load()
        _state.value = _state.value.copy(submitting = false)
        return true
    }
}

private fun failure(error: Throwable): ComplicationsPhase =
    if (error is ApiError.NotFound) {
        ComplicationsPhase.NotFound
    } else {
        ComplicationsPhase.Failed((error as? ApiError)?.messageKey() ?: "error.server")
    }
