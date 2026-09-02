package xyz.klinik.feature.appointments

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import xyz.klinik.network.ApiError
import xyz.klinik.network.Appointment
import xyz.klinik.network.AppointmentStatus
import xyz.klinik.network.AppointmentType
import xyz.klinik.network.AppointmentsApi
import xyz.klinik.network.BookingRefusal
import xyz.klinik.network.UiText
import xyz.klinik.network.messageKey
import xyz.klinik.network.uiText

sealed interface AppointmentsPhase {
    data object Loading : AppointmentsPhase
    data object Loaded : AppointmentsPhase

    /** Nothing booked. Not a failure. */
    data object Empty : AppointmentsPhase

    data object NotFound : AppointmentsPhase
    data class Failed(val messageKey: String) : AppointmentsPhase
}

data class AppointmentsState(
    val phase: AppointmentsPhase = AppointmentsPhase.Loading,
    val appointments: List<Appointment> = emptyList(),
    /** The appointment being acted on, so its buttons can be disabled. */
    val working: String? = null,
    val booking: Boolean = false,
    val error: UiText? = null,
) {
    /**
     * The next one still ahead — what a patient opens this screen for.
     *
     * Compared as ISO-8601 strings, which sort chronologically when they are
     * all UTC, and the server always sends UTC.
     */
    fun next(nowIso: String): Appointment? =
        appointments.firstOrNull { it.scheduledAt >= nowIso && it.status.isUpcoming }

    /** Requests the clinic has not answered yet, which is what staff act on. */
    val awaitingConfirmation: List<Appointment>
        get() = appointments.filter { it.status == AppointmentStatus.REQUESTED }
}

/** Appointments (spec M10). */
class AppointmentsModel(
    private val api: AppointmentsApi,
    /** Null for the caller's own; a patient id for the staff view. */
    private val patientId: String? = null,
) {
    private val _state = MutableStateFlow(AppointmentsState())
    val state: StateFlow<AppointmentsState> = _state.asStateFlow()

    private val lock = Mutex()

    suspend fun refresh() {
        _state.value = _state.value.copy(phase = AppointmentsPhase.Loading)

        try {
            val appointments = patientId?.let { api.forPatient(it) } ?: api.mine()

            _state.value = _state.value.copy(
                appointments = appointments,
                phase = if (appointments.isEmpty()) {
                    AppointmentsPhase.Empty
                } else {
                    AppointmentsPhase.Loaded
                },
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = if (error is ApiError.NotFound) {
                    AppointmentsPhase.NotFound
                } else {
                    AppointmentsPhase.Failed((error as? ApiError)?.messageKey() ?: "error.server")
                },
            )
        }
    }

    /**
     * Asks for an appointment.
     *
     * A refused slot is explained in its own words: "that time is taken" sends
     * someone looking for another slot, where "the clinic is not open then"
     * sends them to another day, and the wrong one wastes their afternoon.
     */
    suspend fun request(
        type: AppointmentType,
        scheduledAt: String,
        staffId: String? = null,
        note: String? = null,
    ): Boolean {
        if (!lock.tryLock()) return false

        _state.value = _state.value.copy(booking = true, error = null)

        try {
            api.request(type, scheduledAt, staffId, note)
        } catch (error: Throwable) {
            _state.value = _state.value.copy(booking = false, error = describe(error))
            return false
        } finally {
            lock.unlock()
        }

        refresh()
        _state.value = _state.value.copy(booking = false)
        return true
    }

    suspend fun confirm(appointmentId: String): Boolean =
        act(appointmentId) { api.confirm(appointmentId) }

    suspend fun cancel(appointmentId: String, reason: String? = null): Boolean =
        act(appointmentId) { api.cancel(appointmentId, reason) }

    suspend fun reschedule(appointmentId: String, scheduledAt: String): Boolean =
        act(appointmentId) { api.reschedule(appointmentId, scheduledAt) }

    /**
     * Replaces the row with what the server returned.
     *
     * Not removed, even when cancelled: a patient who cancelled should see that
     * it is cancelled rather than watch the appointment vanish and wonder
     * whether the clinic got the message.
     */
    private suspend fun act(
        appointmentId: String,
        work: suspend () -> Appointment,
    ): Boolean {
        if (!lock.tryLock()) return false

        _state.value = _state.value.copy(working = appointmentId, error = null)

        val updated = try {
            work()
        } catch (error: Throwable) {
            _state.value = _state.value.copy(working = null, error = describe(error))
            return false
        } finally {
            lock.unlock()
        }

        _state.value = _state.value.copy(
            appointments = _state.value.appointments.map {
                if (it.id == updated.id) updated else it
            },
            working = null,
        )

        return true
    }

    /** The refusal in the words the screen needs, or the generic message. */
    private fun describe(error: Throwable): UiText {
        val apiError = error as? ApiError ?: return UiText.Key("error.server")

        return when (AppointmentsApi.refusal(apiError)) {
            BookingRefusal.SlotTaken -> UiText.Key("appointment.slotTaken")
            BookingRefusal.OutsideAvailability -> UiText.Key("appointment.outsideHours")
            else -> apiError.uiText()
        }
    }
}
