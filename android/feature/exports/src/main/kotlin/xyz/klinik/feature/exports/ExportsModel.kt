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

    /** One patient's exports, or the clinic-wide lists that belong to nobody. */
    data class Group(
        val patientName: String?,
        val mrn: String?,
        val requests: List<ExportRequest>,
    )

    /**
     * The history, grouped by whose it is.
     *
     * A flat list of twenty exports is twenty status badges and twenty
     * timestamps, and finding the summary made for one patient means reading
     * all of them. Grouped, the name is read once and the rows under it are
     * short. Patient lists come last: they are a different kind of thing, and
     * somebody scanning for a person should not have to pass them.
     */
    val grouped: List<Group>
        get() {
            val people = requests
                .filter { it.patientName != null }
                .groupBy { it.patientName.orEmpty() }
                .map { (name, rows) -> Group(name, rows.firstOrNull()?.mrn, rows) }
                // By the newest export in each group, so the file somebody
                // just worked on is at the top.
                .sortedByDescending { it.requests.firstOrNull()?.createdAt.orEmpty() }

            val lists = requests.filter { it.patientName == null }

            return people + if (lists.isEmpty()) emptyList() else listOf(Group(null, null, lists))
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
class ExportsModel(
    private val api: ExportsApi,
    /**
     * Set when the screen belongs to one patient's file.
     *
     * The summary a coordinator asks for from a record used to land in a
     * clinic-wide pile at the bottom of another screen. Scoped, the same list
     * answers "what have I taken out of *this* file".
     */
    private val patientId: String? = null,
) {
    /** Whether this is one patient's history rather than the clinic's. */
    val isScopedToPatient: Boolean get() = patientId != null

    private val _state = MutableStateFlow(ExportsState())
    val state: StateFlow<ExportsState> = _state.asStateFlow()

    suspend fun load() {
        val requests = optional { api.mine(patientId) }
        // The column catalogue drives the patient-list picker, which a
        // patient's own page does not show; asking for it there would fetch
        // something nothing on screen uses.
        val columns = if (patientId == null) optional { api.columns() } else emptyList()

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
