package xyz.klinik.feature.briefing

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import xyz.klinik.network.AppointmentsApi
import xyz.klinik.network.CalendarEntry
import xyz.klinik.network.EmergencyApi
import xyz.klinik.network.PhotosApi
import xyz.klinik.network.ReportsApi
import xyz.klinik.network.StaffEmergencyView
import xyz.klinik.network.attempt
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.Briefing
import xyz.klinik.network.BriefingApi
import xyz.klinik.network.RiskItem
import xyz.klinik.network.RiskKind
import xyz.klinik.network.messageKey

sealed interface BriefingPhase {
    data object Loading : BriefingPhase
    data object Loaded : BriefingPhase

    data class Failed(val messageKey: String) : BriefingPhase
}

data class BriefingState(
    val phase: BriefingPhase = BriefingPhase.Loading,
    val briefing: Briefing? = null,
    /** Open calls, longest wait first. Empty is the normal case. */
    val emergencies: List<StaffEmergencyView> = emptyList(),
    /**
     * Null when this account may not review reports — a different thing from
     * zero, and the screen shows the row only when there is one to show.
     */
    val pendingReportCount: Int? = null,
    /** Null when this account may not see photographs at all. */
    val flaggedPhotoCount: Int? = null,
    /**
     * Today's appointments across every patient the caller can see, earliest
     * first. Null when the calendar could not be read: an empty list would say
     * "nothing booked today", which is a different and possibly false claim.
     */
    val schedule: List<CalendarEntry>? = null,
) {
    /** Nothing is waiting on anybody. */
    val isQuiet: Boolean
        get() = briefing?.quiet == true && emergencies.isEmpty() && atRisk.isEmpty()

    /**
     * What to look at first, worst first.
     *
     * An unanswered emergency outranks everything; after that the order is the
     * one the risks were listed in, which is the server's and not this
     * client's to invent.
     */
    val atRisk: List<RiskItem>
        get() = briefing?.facts?.atRisk.orEmpty()
            .sortedBy { ORDER.indexOf(it.kind).takeIf { index -> index >= 0 } ?: ORDER.size }

    /** The paragraph, when the AI layer wrote one. Never the screen's content. */
    val narrative: String? get() = briefing?.narrative

    private companion object {
        /**
         * Worst first.
         *
         * A clinician reads this list from the top and stops when the phone
         * rings, so the order is the whole value of it. An unanswered
         * emergency is somebody waiting for help; an unreviewed report is
         * paperwork.
         */
        val ORDER = listOf(
            RiskKind.EMERGENCY_UNANSWERED,
            RiskKind.MESSAGE_URGENT,
            RiskKind.COMPLICATION_OVERDUE,
            RiskKind.FOLLOW_UP_MISSED,
            RiskKind.REPORT_UNREVIEWED,
        )
    }
}

/**
 * The clinician's morning (spec M5).
 *
 * Numbers first and the paragraph second, deliberately. The briefing *is* the
 * facts — how many messages came in overnight, who is waiting, what was
 * missed — and the AI layer's prose is a reading of them. A screen drawn off
 * the prose would make a switched-off AI layer look like an empty morning,
 * which is the one impression this screen must never give.
 */
class BriefingModel(
    private val api: BriefingApi,
    private val emergency: EmergencyApi,
    private val reports: ReportsApi,
    private val photos: PhotosApi,
    private val appointments: AppointmentsApi,
    private val clock: () -> Instant = Instant::now,
    private val zone: ZoneId = ZoneId.systemDefault(),
) {
    private val _state = MutableStateFlow(BriefingState())
    val state: StateFlow<BriefingState> = _state.asStateFlow()

    /**
     * Five reads, and only one of them may fail the screen.
     *
     * The briefing is the page; the emergency queue, the report queue and the
     * day's calendar are things a given account may not be allowed to see at
     * all — a coordinator has no `reports.review` — and a 403 on one of those
     * must not blank a nurse's agenda. So the secondary reads are best-effort
     * and their absence is rendered as absence rather than as zero.
     */
    suspend fun refresh() = coroutineScope {
        _state.value = _state.value.copy(phase = BriefingPhase.Loading)

        val day = dayBounds()

        val calls = async { attempt { emergency.queue() } }
        val pending = async { attempt { reports.pending() } }
        val flagged = async { attempt { photos.flagged() } }
        val booked = async { attempt { appointments.calendar(day.first, day.second) } }

        val outcome = attempt { api.mine() }
        val briefing = outcome.value

        if (briefing == null) {
            _state.value = _state.value.copy(
                phase = BriefingPhase.Failed(outcome.error?.messageKey() ?: "error.server"),
            )

            // The others still have to be awaited; abandoning them mid-flight
            // is what `coroutineScope` would complain about.
            calls.await(); pending.await(); flagged.await(); booked.await()

            return@coroutineScope
        }

        _state.value = BriefingState(
            phase = BriefingPhase.Loaded,
            briefing = briefing,
            emergencies = calls.await().value.orEmpty().sortedByDescending { it.waitingMinutes },
            pendingReportCount = pending.await().value?.size,
            flaggedPhotoCount = flagged.await().value?.size,
            // In clock order, which is the only order a day can be read in.
            schedule = booked.await().value?.sortedBy { it.appointment.scheduledAt },
        )
    }

    /**
     * Midnight to midnight in the reader's own zone, not UTC: an appointment
     * at half past midnight in Istanbul belongs to that day on the clinic's
     * wall, and a UTC window would put it on the one before.
     */
    private fun dayBounds(): Pair<String, String> {
        val start = ZonedDateTime.ofInstant(clock(), zone).toLocalDate().atStartOfDay(zone)

        return start.toInstant().toString() to start.plusDays(1).toInstant().toString()
    }
}
