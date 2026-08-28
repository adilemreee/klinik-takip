package xyz.klinik.feature.home.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.home.EmergencyPhase
import xyz.klinik.feature.home.HomeAction
import xyz.klinik.feature.home.HomePhase
import xyz.klinik.feature.home.HomeState

/** Text the screen needs, resolved by the caller from string resources. */
data class HomeStrings(
    val greeting: String,
    val nextAppointment: String,
    val noPatientFile: String,
    val retry: String,
    val cancel: String,
    val close: String,
    val actionTitle: (HomeAction) -> String,
    val emergencyConfirmTitle: String,
    val emergencyConfirmHint: String,
    val emergencyConfirmAction: String,
    val emergencySending: String,
    val emergencySent: String,
    val message: (String) -> String,
)

/**
 * The patient's home screen.
 *
 * One screen, one job (spec section 7). Everything else is reached from exactly
 * five tiles, and the emergency one is always last and always visible — a
 * patient in trouble should not have to scroll.
 */
@Composable
fun HomeScreen(
    state: HomeState,
    emergency: EmergencyPhase,
    strings: HomeStrings,
    onSelect: (HomeAction) -> Unit,
    onArmEmergency: () -> Unit,
    onConfirmEmergency: () -> Unit,
    onCancelEmergency: () -> Unit,
    onAcknowledgeEmergency: () -> Unit,
    onRetry: () -> Unit,
) {
    Surface(color = klinikColor("background"), modifier = Modifier.fillMaxSize()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xl),
            modifier = Modifier.padding(Tokens.Spacing.xl),
        ) {
            Header(state, strings, onRetry)

            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.md),
                verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.md),
            ) {
                items(HomeAction.entries) { action ->
                    ActionTile(
                        action = action,
                        title = strings.actionTitle(action),
                        badge = state.badges[action],
                    ) {
                        // The emergency tile only arms on the first tap (spec M8).
                        if (action == HomeAction.EMERGENCY) onArmEmergency() else onSelect(action)
                    }
                }
            }
        }

        if (emergency !is EmergencyPhase.Idle) {
            EmergencyOverlay(
                phase = emergency,
                strings = strings,
                onConfirm = onConfirmEmergency,
                onCancel = onCancelEmergency,
                onAcknowledge = onAcknowledgeEmergency,
            )
        }
    }
}

@Composable
private fun Header(state: HomeState, strings: HomeStrings, onRetry: () -> Unit) {
    when (val phase = state.phase) {
        HomePhase.Loading -> CircularProgressIndicator()

        // Not retryable, so no retry button: the patient needs to contact the
        // clinic, not tap again.
        HomePhase.NoPatientFile -> Text(
            strings.noPatientFile,
            color = klinikColor("textSecondary"),
            fontSize = Tokens.Typography.body.size,
        )

        is HomePhase.Failed -> Column(
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.md),
        ) {
            Text(
                strings.message(phase.messageKey),
                color = klinikColor("textPrimary"),
                fontSize = Tokens.Typography.body.size,
            )
            Button(onClick = onRetry, modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget)) {
                Text(strings.retry)
            }
        }

        is HomePhase.Loaded -> Column(
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
        ) {
            Text(
                "${strings.greeting}, ${phase.summary.patient.firstName}",
                fontSize = Tokens.Typography.title.size,
                fontWeight = Tokens.Typography.title.weight,
                color = klinikColor("textPrimary"),
                modifier = Modifier.semantics { heading() },
            )

            phase.summary.nextAppointment?.let {
                Text(
                    "${strings.nextAppointment}: ${it.scheduledAt}",
                    fontSize = Tokens.Typography.body.size,
                    color = klinikColor("textSecondary"),
                )
            }
        }
    }
}

@Composable
private fun ActionTile(action: HomeAction, title: String, badge: Int?, onClick: () -> Unit) {
    val isEmergency = action == HomeAction.EMERGENCY

    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(
            containerColor = klinikColor(if (isEmergency) "critical" else "surface"),
            contentColor = klinikColor(if (isEmergency) "accentText" else "textPrimary"),
        ),
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 110.dp)
            // One announcement per tile, including the count, rather than
            // fragments a screen-reader user has to assemble.
            .semantics {
                contentDescription = if (badge == null) title else "$title, $badge"
            },
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
            modifier = Modifier.clearAndSetSemantics {},
        ) {
            Text(title, fontSize = Tokens.Typography.subheading.size)
            if (badge != null) {
                Text("$badge", fontSize = Tokens.Typography.caption.size)
            }
        }
    }
}

/**
 * The confirming step, the outcome, and — when the alert did not get through —
 * a clear statement that the clinic has not been told.
 */
@Composable
private fun EmergencyOverlay(
    phase: EmergencyPhase,
    strings: HomeStrings,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    onAcknowledge: () -> Unit,
) {
    Surface(color = klinikColor("background"), modifier = Modifier.fillMaxSize()) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(Tokens.Spacing.xxl)) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xl),
            ) {
                when (phase) {
                    is EmergencyPhase.Confirming -> {
                        Text(
                            strings.emergencyConfirmTitle,
                            fontSize = Tokens.Typography.heading.size,
                            modifier = Modifier.semantics { heading() },
                        )
                        Text(strings.emergencyConfirmHint, fontSize = Tokens.Typography.body.size)

                        Button(
                            onClick = onConfirm,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = Tokens.minimumTouchTarget),
                        ) {
                            Text("${strings.emergencyConfirmAction} (${phase.secondsRemaining})")
                        }

                        TextButton(onClick = onCancel) { Text(strings.cancel) }
                    }

                    EmergencyPhase.Sending -> {
                        CircularProgressIndicator()
                        Text(strings.emergencySending)
                    }

                    EmergencyPhase.Sent -> {
                        Text(strings.emergencySent, fontSize = Tokens.Typography.body.size)
                        Button(
                            onClick = onAcknowledge,
                            modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                        ) {
                            Text(strings.close)
                        }
                    }

                    is EmergencyPhase.Failed -> {
                        Text(
                            strings.message(phase.messageKey),
                            color = klinikColor("critical"),
                            fontSize = Tokens.Typography.body.size,
                        )

                        if (phase.canRetry) {
                            Button(
                                onClick = onConfirm,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(min = Tokens.minimumTouchTarget),
                            ) {
                                Text(strings.retry)
                            }
                        }

                        TextButton(onClick = onAcknowledge) { Text(strings.close) }
                    }

                    EmergencyPhase.Idle -> Unit
                }
            }
        }
    }
}
