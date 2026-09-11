package xyz.klinik.feature.exports

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.ExportColumn
import xyz.klinik.network.ExportFormat
import xyz.klinik.network.ExportRequest
import xyz.klinik.network.ExportStatus
import xyz.klinik.network.ExportsApi
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface ExportsPhase {
    data object Loading : ExportsPhase
    data object Loaded : ExportsPhase

    /** Not a failure: an account without `export.create` has no screen here. */
    data object NotPermitted : ExportsPhase
}

data class ExportsState(
    val phase: ExportsPhase = ExportsPhase.Loading,
    /** Newest first. */
    val requests: List<ExportRequest> = emptyList(),
    /** The catalogue, with what this viewer may take marked on it. */
    val columns: List<ExportColumn> = emptyList(),
    val chosen: Set<String> = emptySet(),
    val format: ExportFormat = ExportFormat.CSV,
    val busy: Boolean = false,
    val error: UiText? = null,
) {
    /**
     * Grouped the way the catalogue groups them, so the picker reads as
     * sections rather than sixty checkboxes.
     */
    val groupedColumns: List<Pair<String, List<ExportColumn>>>
        get() = columns.groupBy { it.group }.toList().sortedBy { it.first }

    val hasUnfinished: Boolean
        get() = requests.any {
            it.status == ExportStatus.QUEUED || it.status == ExportStatus.PROCESSING
        }
}

/**
 * Taking data out of the clinic (spec M12).
 *
 * Every export is written to the audit log — who took what, and when — and the
 * download link is asked for separately and recorded again. That is the
 * server's doing; what this screen must not do is make any of it invisible. So
 * a finished export is never downloaded on its own: somebody presses a button,
 * and that press is the thing the log records.
 *
 * Columns come from the server marked with whether this viewer may have them.
 * A column somebody cannot export is shown and disabled rather than hidden —
 * hiding it would make an incomplete spreadsheet look like a complete one.
 */
class ExportsModel(private val api: ExportsApi) {
    private val _state = MutableStateFlow(ExportsState())
    val state: StateFlow<ExportsState> = _state.asStateFlow()

    suspend fun load() {
        val requests = optional { api.mine() }
        val columns = optional { api.columns() }

        val current = _state.value

        _state.value = current.copy(
            phase = if (requests == null && columns == null) {
                ExportsPhase.NotPermitted
            } else {
                ExportsPhase.Loaded
            },
            requests = requests.orEmpty().sortedByDescending { it.createdAt.orEmpty() },
            columns = columns.orEmpty(),
            // A first visit starts with everything the viewer may take, which
            // is the common case; unticking is faster than ticking forty boxes.
            chosen = if (current.chosen.isEmpty()) {
                columns.orEmpty().filter { it.available }.map { it.key }.toSet()
            } else {
                current.chosen
            },
        )
    }

    fun toggle(key: String) {
        val chosen = _state.value.chosen

        _state.value = _state.value.copy(
            chosen = if (key in chosen) chosen - key else chosen + key,
        )
    }

    fun choose(format: ExportFormat) {
        _state.value = _state.value.copy(format = format)
    }

    suspend fun requestPatientList(from: String?, to: String?, country: String?) {
        _state.value = _state.value.copy(busy = true, error = null)

        try {
            val request = api.requestPatientList(
                format = _state.value.format,
                columns = _state.value.chosen.sorted(),
                from = from,
                to = to,
                country = country?.ifBlank { null },
            )

            _state.value = _state.value.copy(
                requests = listOf(request) + _state.value.requests,
                busy = false,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busy = false, error = messageFor(error))
        }
    }

    /**
     * Refreshes only the ones still working.
     *
     * A finished export never changes, and re-reading forty of them every
     * three seconds is a battery complaint.
     */
    suspend fun refreshUnfinished() {
        val working = _state.value.requests.filter {
            it.status == ExportStatus.QUEUED || it.status == ExportStatus.PROCESSING
        }

        for (request in working) {
            val updated = optional { api.status(request.id) } ?: continue

            _state.value = _state.value.copy(
                requests = _state.value.requests.map {
                    if (it.id == updated.id) updated else it
                },
            )
        }
    }

    /**
     * The signed link.
     *
     * Asking for one is itself recorded, which is why it happens on a press
     * rather than as soon as the file is ready.
     */
    suspend fun download(id: String): String? {
        _state.value = _state.value.copy(error = null)

        return try {
            api.download(id).url
        } catch (error: Throwable) {
            _state.value = _state.value.copy(error = messageFor(error))
            null
        }
    }

    private suspend fun <T> optional(work: suspend () -> T): T? =
        runCatching { work() }.getOrNull()

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
