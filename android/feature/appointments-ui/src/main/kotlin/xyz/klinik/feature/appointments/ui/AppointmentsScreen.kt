package xyz.klinik.feature.appointments.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.appointments.AppointmentsPhase
import xyz.klinik.feature.appointments.AppointmentsState
import xyz.klinik.network.Appointment
import xyz.klinik.network.AppointmentStatus
import xyz.klinik.network.UiText

data class AppointmentStrings(
    val empty: String,
    val notFound: String,
    val retry: String,
    val next: String,
    val awaitingConfirmation: String,
    val confirm: String,
    val cancel: String,
    val typeName: (Appointment) -> String,
    val statusName: (AppointmentStatus) -> String,
    val message: (UiText) -> String,
)

/** Appointments and the request/approval flow (spec M10). */
@Composable
fun AppointmentsScreen(
    state: AppointmentsState,
    strings: AppointmentStrings,
    /** Staff confirm a requested slot; a patient asks and cancels. */
    canConfirm: Boolean,
    /** Now, as ISO-8601, supplied by the caller — see FollowUpScreen. */
    nowIso: String,
    onRetry: () -> Unit,
    onConfirm: (String) -> Unit,
    onCancel: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            AppointmentsPhase.Loading -> Centered { CircularProgressIndicator() }

            AppointmentsPhase.Empty -> Centered { Text(strings.empty) }

            AppointmentsPhase.NotFound -> Centered { Text(strings.notFound) }

            is AppointmentsPhase.Failed -> Centered {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(strings.message(UiText.Key(phase.messageKey)))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            AppointmentsPhase.Loaded -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Tokens.Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
            ) {
                state.error?.let { Text(strings.message(it), color = klinikColor("critical")) }

                // The next one, first and large — what this screen is opened
                // to find.
                state.next(nowIso)?.let { next ->
                    Surface(color = klinikColor("infoSurface"), modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(Tokens.Spacing.lg),
                            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
                        ) {
                            Text(strings.next, color = klinikColor("textSecondary"))
                            Text(
                                strings.typeName(next),
                                color = klinikColor("textPrimary"),
                                modifier = Modifier.semantics { heading() },
                            )
                            Text(next.scheduledAt, color = klinikColor("textPrimary"))
                            next.location?.let {
                                Text(it, color = klinikColor("textSecondary"))
                            }
                        }
                    }
                }

                val awaiting = state.appointments.count { it.status == AppointmentStatus.REQUESTED }
                if (awaiting > 0) {
                    Text(
                        "${strings.awaitingConfirmation}: $awaiting",
                        color = klinikColor("warning"),
                    )
                }

                for (appointment in state.appointments) {
                    AppointmentRow(
                        appointment,
                        strings,
                        canConfirm,
                        state.working == appointment.id,
                        onConfirm,
                        onCancel,
                    )
                }
            }
        }
    }
}

@Composable
private fun AppointmentRow(
    appointment: Appointment,
    strings: AppointmentStrings,
    canConfirm: Boolean,
    isWorking: Boolean,
    onConfirm: (String) -> Unit,
    onCancel: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                strings.typeName(appointment),
                color = klinikColor("textPrimary"),
                modifier = Modifier.weight(1f),
            )

            Text(strings.statusName(appointment.status), color = tintFor(appointment.status))
        }

        Text(appointment.scheduledAt, color = klinikColor("textSecondary"))

        appointment.cancelledReason?.let {
            Text(it, color = klinikColor("textSecondary"))
        }

        if (appointment.status.isUpcoming) {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.md)) {
                if (canConfirm && appointment.status == AppointmentStatus.REQUESTED) {
                    TextButton(
                        onClick = { onConfirm(appointment.id) },
                        enabled = !isWorking,
                        modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                    ) { Text(strings.confirm) }
                }

                TextButton(
                    onClick = { onCancel(appointment.id) },
                    enabled = !isWorking,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) { Text(strings.cancel) }
            }
        }
    }
}

@Composable
private fun tintFor(status: AppointmentStatus) = when (status) {
    AppointmentStatus.CONFIRMED -> klinikColor("success")
    AppointmentStatus.REQUESTED -> klinikColor("warning")
    AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW -> klinikColor("textSecondary")
    AppointmentStatus.COMPLETED -> klinikColor("info")
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.xl),
        contentAlignment = Alignment.Center,
    ) { content() }
}
