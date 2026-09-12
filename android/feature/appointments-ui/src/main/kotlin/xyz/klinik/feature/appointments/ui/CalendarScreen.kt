package xyz.klinik.feature.appointments.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.appointments.CalendarPhase
import xyz.klinik.feature.appointments.CalendarState
import xyz.klinik.network.Appointment
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class CalendarStrings(
    val title: String,
    val notPermitted: String,
    val retry: String,
    val previousMonth: String,
    val nextMonth: String,
    val nothingThatDay: String,
    val hasRequest: String,
    val appointmentCount: (Int) -> String,
    val minutes: (Int) -> String,
    val monthName: (YearMonth) -> String,
    val weekdayInitial: (Int) -> String,
    val dayLabel: (LocalDate) -> String,
    val typeName: (Appointment) -> String,
    val statusName: (Appointment) -> String,
    val message: (UiText) -> String,
)

/**
 * The clinic's month (spec M3).
 *
 * A grid rather than a list, because the question it answers is about shape:
 * which days are full, which are empty, and where a request is still waiting
 * on somebody. The list underneath answers the next question — what is
 * actually on the day that was tapped — and both are needed.
 *
 * A day with an unconfirmed request is marked in a word as well as a dot,
 * since a mark a reader cannot distinguish by colour is not a mark at all
 * (spec section 7).
 */
@Composable
fun CalendarScreen(
    state: CalendarState,
    strings: CalendarStrings,
    zone: ZoneId,
    onShowMonth: (YearMonth) -> Unit,
    onSelectDay: (LocalDate) -> Unit,
    onOpenAppointment: (Appointment) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            CalendarPhase.Loading -> Centred { CircularProgressIndicator() }

            CalendarPhase.NotPermitted -> Centred {
                Text(
                    strings.notPermitted,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            is CalendarPhase.Failed -> Centred {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(strings.message(phase.message), color = klinikColor("critical"))
                    TextButton(
                        onClick = onRetry,
                        modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                    ) {
                        Text(strings.retry)
                    }
                }
            }

            CalendarPhase.Loaded -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Tokens.Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
            ) {
                Text(
                    strings.title,
                    fontSize = Tokens.Typography.heading.size,
                    fontWeight = Tokens.Typography.heading.weight,
                    color = klinikColor("textPrimary"),
                    modifier = Modifier.semantics { heading() },
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(
                        onClick = { onShowMonth(state.month.minusMonths(1)) },
                        modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                    ) {
                        Text(strings.previousMonth)
                    }

                    Text(
                        strings.monthName(state.month),
                        color = klinikColor("textPrimary"),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.weight(1f),
                    )

                    TextButton(
                        onClick = { onShowMonth(state.month.plusMonths(1)) },
                        modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                    ) {
                        Text(strings.nextMonth)
                    }
                }

                MonthGrid(state, strings, zone, onSelectDay)

                Section(state.selected?.let(strings.dayLabel).orEmpty()) {
                    val appointments = state.forSelected(zone)

                    if (appointments.isEmpty()) {
                        Text(strings.nothingThatDay, color = klinikColor("textSecondary"))
                    }

                    appointments.forEach { appointment ->
                        AppointmentRow(appointment, strings, zone, onOpenAppointment)
                    }
                }
            }
        }
    }
}

@Composable
private fun MonthGrid(
    state: CalendarState,
    strings: CalendarStrings,
    zone: ZoneId,
    onSelectDay: (LocalDate) -> Unit,
) {
    val byDay = state.byDay(zone)
    val awaiting = state.awaitingConfirmation(zone)
    val first = state.month.atDay(1)

    // Monday-first: the week as this clinic reads it. `dayOfWeek` is 1 for
    // Monday in java.time, so the blank cells before the first are its value
    // minus one.
    val leading = first.dayOfWeek.value - 1

    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs)) {
            (1..7).forEach { day ->
                Text(
                    strings.weekdayInitial(day),
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        val cells = leading + state.month.lengthOfMonth()
        val weeks = (cells + 6) / 7

        (0 until weeks).forEach { week ->
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs)) {
                (0 until 7).forEach { slot ->
                    val index = week * 7 + slot
                    val dayOfMonth = index - leading + 1

                    if (dayOfMonth < 1 || dayOfMonth > state.month.lengthOfMonth()) {
                        Box(modifier = Modifier.weight(1f).aspectRatio(1f))
                        return@forEach
                    }

                    val date = state.month.atDay(dayOfMonth)

                    DayCell(
                        date = date,
                        count = byDay[date].orEmpty().size,
                        hasRequest = date in awaiting,
                        selected = date == state.selected,
                        strings = strings,
                        onSelect = onSelectDay,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

@Composable
private fun DayCell(
    date: LocalDate,
    count: Int,
    hasRequest: Boolean,
    selected: Boolean,
    strings: CalendarStrings,
    onSelect: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
) {
    val spoken = buildString {
        append(strings.dayLabel(date))
        append(", ")
        append(strings.appointmentCount(count))
        // A mark nobody can distinguish by colour is not a mark, so the
        // waiting request is in the spoken label too.
        if (hasRequest) {
            append(", ")
            append(strings.hasRequest)
        }
    }

    Box(
        modifier = modifier
            .aspectRatio(1f)
            .heightIn(min = Tokens.minimumTouchTarget)
            .clip(RoundedCornerShape(Tokens.Radius.sm))
            .background(
                when {
                    selected -> klinikColor("accent")
                    hasRequest -> klinikColor("warningSurface")
                    count > 0 -> klinikColor("surface")
                    else -> klinikColor("background")
                },
            )
            .clickable { onSelect(date) }
            .semantics(mergeDescendants = true) {
                contentDescription = spoken
                this.selected = selected
            },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                date.dayOfMonth.toString(),
                color = if (selected) klinikColor("accentText") else klinikColor("textPrimary"),
            )

            if (count > 0) {
                Text(
                    count.toString(),
                    fontSize = Tokens.Typography.footnote.size,
                    color = if (selected) {
                        klinikColor("accentText")
                    } else {
                        klinikColor("textSecondary")
                    },
                )
            }
        }
    }
}

@Composable
private fun AppointmentRow(
    appointment: Appointment,
    strings: CalendarStrings,
    zone: ZoneId,
    onOpen: (Appointment) -> Unit,
) {
    val at = java.time.ZonedDateTime.parse(appointment.scheduledAt).withZoneSameInstant(zone)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = Tokens.minimumTouchTarget)
            .clickable { onOpen(appointment) }
            .padding(vertical = Tokens.Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "%02d:%02d".format(at.hour, at.minute),
            color = klinikColor("textPrimary"),
            modifier = Modifier.padding(end = Tokens.Spacing.md),
        )

        Column(modifier = Modifier.weight(1f)) {
            Text(strings.typeName(appointment), color = klinikColor("textPrimary"))
            Text(
                "${strings.statusName(appointment)} · ${strings.minutes(appointment.durationMinutes)}",
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
            )
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Surface(color = klinikColor("surface"), modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
        ) {
            Text(
                title,
                fontSize = Tokens.Typography.subheading.size,
                fontWeight = Tokens.Typography.subheading.weight,
                color = klinikColor("textPrimary"),
                modifier = Modifier.semantics { heading() },
            )

            content()
        }
    }
}

@Composable
private fun Centred(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.xl),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { content() }
    }
}
