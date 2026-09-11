package xyz.klinik.feature.emergency.ui

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
import androidx.compose.material3.Button
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
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.emergency.EmergencyQueueState
import xyz.klinik.feature.emergency.QueuePhase
import xyz.klinik.network.StaffEmergencyView
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class EmergencyQueueStrings(
    val title: String,
    val empty: String,
    val retry: String,
    val unanswered: String,
    val waitingMinutes: (Int) -> String,
    val acknowledge: String,
    val resolve: String,
    val bloodType: String,
    val allergies: String,
    val conditions: String,
    val medications: String,
    val lastSurgery: String,
    val none: String,
    val call: String,
    val message: (UiText) -> String,
)

/**
 * The calls a clinic has not answered (spec M8).
 *
 * Longest wait first, and the ones the escalation ladder gave up on in their
 * own section above the rest — "waiting" and "nobody answered" are different
 * situations, and only one of them is somebody's responsibility this minute.
 *
 * Each row carries the clinical summary a clinician needs before they pick up
 * the phone: blood type, allergies, what the patient is on, and what was
 * operated on. Somebody deciding whether to send an ambulance should not have
 * to open a second screen to find out about a penicillin allergy.
 */
@Composable
fun EmergencyQueueScreen(
    state: EmergencyQueueState,
    strings: EmergencyQueueStrings,
    onRetry: () -> Unit,
    onAcknowledge: (String) -> Unit,
    onResolve: (String) -> Unit,
    onCall: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            QueuePhase.Loading -> Centered { CircularProgressIndicator() }

            // Nobody waiting is the good state and should look like one, not
            // like a list that failed to load.
            QueuePhase.Empty -> Centered {
                Text(strings.empty, color = klinikColor("textSecondary"))
            }

            is QueuePhase.Failed -> Centered {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(strings.message(UiText.Key(phase.messageKey)))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            QueuePhase.Loaded -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Tokens.Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
            ) {
                state.error?.let { Text(strings.message(it), color = klinikColor("critical")) }

                if (state.unanswered.isNotEmpty()) {
                    Text(
                        strings.unanswered,
                        color = klinikColor("critical"),
                        modifier = Modifier.semantics { heading() },
                    )

                    for (call in state.unanswered) {
                        CallCard(call, strings, state.working, onAcknowledge, onResolve, onCall)
                    }
                }

                for (call in state.waiting) {
                    CallCard(call, strings, state.working, onAcknowledge, onResolve, onCall)
                }
            }
        }
    }
}

@Composable
private fun CallCard(
    call: StaffEmergencyView,
    strings: EmergencyQueueStrings,
    working: String?,
    onAcknowledge: (String) -> Unit,
    onResolve: (String) -> Unit,
    onCall: (String) -> Unit,
) {
    val busy = working == call.event.id

    Surface(
        color = if (call.unanswered) klinikColor("criticalSurface") else klinikColor("surface"),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
        ) {
            Text(
                call.summary.fullName,
                fontSize = Tokens.Typography.subheading.size,
                fontWeight = Tokens.Typography.subheading.weight,
                color = klinikColor("textPrimary"),
                modifier = Modifier.semantics { heading() },
            )

            Text(
                strings.waitingMinutes(call.waitingMinutes),
                color = if (call.unanswered) klinikColor("critical") else klinikColor("textSecondary"),
            )

            SummaryRow(strings.bloodType, call.summary.bloodType ?: strings.none)
            SummaryRow(strings.allergies, call.summary.allergies.joinOr(strings.none))
            SummaryRow(strings.conditions, call.summary.chronicConditions.joinOr(strings.none))
            SummaryRow(strings.medications, call.summary.currentMedications.joinOr(strings.none))

            call.summary.lastSurgery?.let {
                SummaryRow(strings.lastSurgery, "${it.procedureName} · ${it.daysAgo}")
            }

            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
                // First, and its own button: the fastest useful thing a
                // clinician can do with this screen is ring the patient.
                call.summary.phone?.let { phone ->
                    Button(
                        onClick = { onCall(phone) },
                        modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                    ) {
                        Text(strings.call)
                    }
                }

                TextButton(
                    onClick = { onAcknowledge(call.event.id) },
                    enabled = !busy,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.acknowledge)
                }

                TextButton(
                    onClick = { onResolve(call.event.id) },
                    enabled = !busy,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.resolve)
                }
            }
        }
    }
}

/** One announcement per fact rather than two fragments a reader assembles. */
@Composable
private fun SummaryRow(label: String, value: String) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
        modifier = Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) { contentDescription = "$label: $value" },
    ) {
        Text(
            label,
            fontSize = Tokens.Typography.caption.size,
            color = klinikColor("textSecondary"),
            modifier = Modifier.clearAndSetSemantics {},
        )
        Text(
            value,
            fontSize = Tokens.Typography.caption.size,
            color = klinikColor("textPrimary"),
            modifier = Modifier.clearAndSetSemantics {},
        )
    }
}

/** An empty list of allergies is "none recorded", not a blank. */
private fun List<String>.joinOr(fallback: String): String =
    if (isEmpty()) fallback else joinToString(", ")

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxSize()
            .padding(Tokens.Spacing.xl),
    ) {
        content()
    }
}
