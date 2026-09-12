package xyz.klinik.feature.appointments

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.AppointmentsApi
import xyz.klinik.network.AvailabilityWindow
import xyz.klinik.network.SetAvailabilityWindow
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface AvailabilityPhase {
    data object Loading : AvailabilityPhase
    data object Loaded : AvailabilityPhase

    /**
     * No window at all.
     *
     * Its own state and worth a sentence: the system does not offer
     * appointments with a clinician who has published no hours, so an empty
     * list means nobody can book them — which looks identical to a calendar
     * that happens to be free.
     */
    data object None : AvailabilityPhase

    /** This login has no staff record: working hours belong to a person. */
    data object NoProfile : AvailabilityPhase
    data class Failed(val message: UiText) : AvailabilityPhase
}

data class AvailabilityState(
    val phase: AvailabilityPhase = AvailabilityPhase.Loading,
    val windows: List<AvailabilityWindow> = emptyList(),
    val busyId: String? = null,
    val error: UiText? = null,
) {
    /** Monday first, then by start time: the week as a person reads it. */
    val byDay: List<Pair<Int, List<AvailabilityWindow>>>
        get() = windows
            .groupBy { it.dayOfWeek }
            .toList()
            .sortedBy { (day, _) -> if (day == 0) 7 else day }
            .map { (day, list) -> day to list.sortedBy { it.startTime } }

    val open: List<AvailabilityWindow> get() = windows.filter { it.isActive }
}

/** Why a window would be refused, before it is sent. */
sealed interface WindowProblem {
    data object EndBeforeStart : WindowProblem

    val stringKey: String get() = "availability.endBeforeStart"
}

/**
 * When a clinician can be booked (spec M3).
 *
 * A weekly pattern, not a calendar of slots: working hours are "Monday to
 * Friday, nine to five", and a database of ten thousand slots saying that is
 * one nobody can correct.
 *
 * Switching a window off is kept separate from removing it, because they mean
 * different things. Off is a week away and the pattern survives; removed is
 * gone, and somebody back from leave would have to write their whole week out
 * again. Neither cancels appointments already booked in that window — the
 * server does not, and a screen implying otherwise would have clinicians
 * turning up to nothing.
 */
class AvailabilityModel(
    private val api: AppointmentsApi,
    private val timezone: String,
) {
    private val _state = MutableStateFlow(AvailabilityState())
    val state: StateFlow<AvailabilityState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = AvailabilityPhase.Loading)

        try {
            val windows = api.availability()

            _state.value = AvailabilityState(
                phase = if (windows.isEmpty()) AvailabilityPhase.None else AvailabilityPhase.Loaded,
                windows = windows,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = when {
                    // A coordinator's login has no staff record to publish
                    // hours for, which is a different sentence from a failure.
                    error is ApiError.NotFound -> AvailabilityPhase.NoProfile
                    else -> AvailabilityPhase.Failed(messageFor(error))
                },
            )
        }
    }

    /** Checked here so a clinician is told before the round trip. */
    fun check(startTime: String, endTime: String): WindowProblem? =
        if (endTime <= startTime) WindowProblem.EndBeforeStart else null

    suspend fun add(dayOfWeek: Int, startTime: String, endTime: String): Boolean {
        check(startTime, endTime)?.let { problem ->
            _state.value = _state.value.copy(error = UiText.Key(problem.stringKey))
            return false
        }

        _state.value = _state.value.copy(busyId = NEW, error = null)

        return try {
            val window = api.setAvailability(
                SetAvailabilityWindow(dayOfWeek, startTime, endTime, timezone),
            )

            _state.value = _state.value.copy(
                phase = AvailabilityPhase.Loaded,
                windows = _state.value.windows + window,
                busyId = null,
            )

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busyId = null, error = messageFor(error))
            false
        }
    }

    /** A week away. The pattern stays, so it can be switched back on. */
    suspend fun setOpen(window: AvailabilityWindow, open: Boolean): Boolean {
        _state.value = _state.value.copy(busyId = window.id, error = null)

        return try {
            val updated = api.updateAvailability(
                window.id,
                SetAvailabilityWindow(
                    dayOfWeek = window.dayOfWeek,
                    startTime = window.startTime,
                    endTime = window.endTime,
                    timezone = window.timezone,
                    isActive = open,
                ),
            )

            _state.value = _state.value.copy(
                // Replaced with what the server returned: a switch that
                // flipped locally would show hours as published that nobody
                // can book.
                windows = _state.value.windows.map { if (it.id == updated.id) updated else it },
                busyId = null,
            )

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busyId = null, error = messageFor(error))
            false
        }
    }

    suspend fun remove(window: AvailabilityWindow): Boolean {
        _state.value = _state.value.copy(busyId = window.id, error = null)

        return try {
            api.removeAvailability(window.id)

            val remaining = _state.value.windows.filterNot { it.id == window.id }

            _state.value = _state.value.copy(
                phase = if (remaining.isEmpty()) {
                    AvailabilityPhase.None
                } else {
                    AvailabilityPhase.Loaded
                },
                windows = remaining,
                busyId = null,
            )

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busyId = null, error = messageFor(error))
            false
        }
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")

    private companion object {
        const val NEW = "new"
    }
}
