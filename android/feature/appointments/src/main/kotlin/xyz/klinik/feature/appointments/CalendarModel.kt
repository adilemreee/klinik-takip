package xyz.klinik.feature.appointments

import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.Appointment
import xyz.klinik.network.AppointmentStatus
import xyz.klinik.network.AppointmentsApi
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface CalendarPhase {
    data object Loading : CalendarPhase
    data object Loaded : CalendarPhase

    /** Not a failure: the calendar needs `appointments.read`. */
    data object NotPermitted : CalendarPhase
    data class Failed(val message: UiText) : CalendarPhase
}

data class CalendarState(
    val phase: CalendarPhase = CalendarPhase.Loading,
    val month: YearMonth = YearMonth.now(),
    val appointments: List<Appointment> = emptyList(),
    /** The day whose appointments are listed underneath the grid. */
    val selected: LocalDate? = null,
) {
    /**
     * Appointments per day, in the clinic's own zone.
     *
     * A cancelled appointment is not on the calendar: the slot is free, and a
     * grid that still showed it would have a clinician reading a full day that
     * is not.
     */
    fun byDay(zone: ZoneId): Map<LocalDate, List<Appointment>> =
        appointments
            .filterNot { it.status == AppointmentStatus.CANCELLED }
            .groupBy { ZonedDateTime.parse(it.scheduledAt).withZoneSameInstant(zone).toLocalDate() }

    fun forSelected(zone: ZoneId): List<Appointment> =
        selected?.let { day -> byDay(zone)[day].orEmpty().sortedBy { it.scheduledAt } }.orEmpty()

    /** Days with something still waiting on the clinic to confirm it. */
    fun awaitingConfirmation(zone: ZoneId): Set<LocalDate> =
        byDay(zone)
            .filterValues { day -> day.any { it.status == AppointmentStatus.REQUESTED } }
            .keys
}

/**
 * The clinic's month (spec M3).
 *
 * A calendar rather than a list, because the question it answers is about
 * shape: which days are full, which are empty, and where a request is still
 * waiting. The list underneath answers the next question — what is actually on
 * the day somebody tapped — and both are needed.
 *
 * The window asked for is the whole month in the clinic's own zone, not a
 * rolling thirty days: a month that started on the third would put the first
 * two days of it out of reach.
 */
class CalendarModel(
    private val api: AppointmentsApi,
    private val zone: ZoneId = ZoneId.systemDefault(),
    private val today: () -> LocalDate = { LocalDate.now(zone) },
) {
    private val _state = MutableStateFlow(CalendarState(month = YearMonth.from(today())))
    val state: StateFlow<CalendarState> = _state.asStateFlow()

    suspend fun load(month: YearMonth = _state.value.month) {
        _state.value = _state.value.copy(phase = CalendarPhase.Loading, month = month)

        val from = month.atDay(1).atStartOfDay(zone).toInstant().toString()
        // The first instant of the next month, exclusive: an appointment at
        // 23:30 on the last day belongs to this month and a same-day bound
        // would drop it.
        val to = month.plusMonths(1).atDay(1).atStartOfDay(zone).toInstant().toString()

        try {
            val appointments = api.calendar(from, to)

            _state.value = _state.value.copy(
                phase = CalendarPhase.Loaded,
                appointments = appointments,
                // The day somebody is most likely to want: today when it is in
                // this month, the first otherwise.
                selected = _state.value.selected?.takeIf { YearMonth.from(it) == month }
                    ?: today().takeIf { YearMonth.from(it) == month }
                    ?: month.atDay(1),
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = if (error is ApiError.Forbidden) {
                    CalendarPhase.NotPermitted
                } else {
                    CalendarPhase.Failed(messageFor(error))
                },
            )
        }
    }

    suspend fun show(month: YearMonth) = load(month)

    fun select(day: LocalDate) {
        _state.value = _state.value.copy(selected = day)
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
