package xyz.klinik.feature.medications.ui

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
import androidx.compose.material3.HorizontalDivider
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
import xyz.klinik.feature.medications.MedicationsPhase
import xyz.klinik.feature.medications.MedicationsState
import xyz.klinik.network.Adherence
import xyz.klinik.network.DoseLog
import xyz.klinik.network.DoseStatus
import xyz.klinik.network.MedicationView

/** Every string the screen needs, resolved once by the caller. */
data class MedicationStrings(
    val title: String,
    val today: String,
    val empty: String,
    val notFound: String,
    val retry: String,
    val adherence: String,
    val noScoreYet: String,
    val streak: String,
    val taken: String,
    val snooze: String,
    val skipped: String,
    val nextDose: String,
    val awaitingApproval: String,
    val stopped: String,
    val statusName: (DoseStatus) -> String,
    val badgeName: (String) -> String,
    val message: (String) -> String,
)

/** The patient's medications and today's check-in (spec M9). */
@Composable
fun MedicationsScreen(
    state: MedicationsState,
    strings: MedicationStrings,
    onRetry: () -> Unit,
    onCheckIn: (logId: String, action: String, snoozeMinutes: Int?) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            MedicationsPhase.Loading -> Centered { CircularProgressIndicator() }

            MedicationsPhase.Empty -> Centered { Text(strings.empty) }

            MedicationsPhase.NotFound -> Centered { Text(strings.notFound) }

            is MedicationsPhase.Failed -> Centered {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(strings.message(phase.messageKey))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            MedicationsPhase.Loaded -> Loaded(state, strings, onCheckIn)
        }
    }
}

@Composable
private fun Loaded(
    state: MedicationsState,
    strings: MedicationStrings,
    onCheckIn: (String, String, Int?) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Tokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
    ) {
        state.error?.let { key ->
            Text(strings.message(key), color = klinikColor("critical"))
        }

        state.overall?.let { AdherenceCard(it, state.badges, strings) }

        if (state.today.isNotEmpty()) {
            Text(
                strings.today,
                color = klinikColor("textPrimary"),
                modifier = Modifier.semantics { heading() },
            )

            for (dose in state.today) {
                DoseRow(dose, state.medicationFor(dose), state.working == dose.id, strings, onCheckIn)
            }
        }

        if (state.medications.isNotEmpty()) {
            HorizontalDivider()

            for (entry in state.medications) {
                MedicationRow(entry, strings)
            }
        }
    }
}

/**
 * The adherence score, or an honest absence of one.
 *
 * A course with nothing due yet has no score. Drawing that as 0% tells a patient
 * on their first morning that they are already failing, which is the opposite of
 * what an adherence screen is for (spec M9).
 */
@Composable
private fun AdherenceCard(
    adherence: Adherence,
    badges: List<String>,
    strings: MedicationStrings,
) {
    Surface(
        color = klinikColor("infoSurface"),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
        ) {
            Text(strings.adherence, color = klinikColor("textSecondary"))

            val percentage = adherence.percentage

            if (percentage != null) {
                Text("%$percentage", color = klinikColor("textPrimary"))
            } else {
                Text(strings.noScoreYet, color = klinikColor("textSecondary"))
            }

            if (adherence.streak > 0) {
                Text("${strings.streak}: ${adherence.streak}", color = klinikColor("textSecondary"))
            }

            // Withheld by the server while a course is going badly — the tone
            // rule from M9. Whatever arrives is shown; nothing is invented here
            // to fill the space.
            for (badge in badges) {
                Text(strings.badgeName(badge), color = klinikColor("success"))
            }
        }
    }
}

@Composable
private fun DoseRow(
    dose: DoseLog,
    medication: xyz.klinik.network.Medication?,
    isWorking: Boolean,
    strings: MedicationStrings,
    onCheckIn: (String, String, Int?) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                medication?.drugName ?: strings.title,
                color = klinikColor("textPrimary"),
                modifier = Modifier.weight(1f),
            )

            // In words as well as colour: a colour a reader cannot distinguish
            // says nothing (spec section 7).
            Text(strings.statusName(dose.status), color = tintFor(dose.status))
        }

        medication?.dose?.let { Text(it, color = klinikColor("textSecondary")) }

        if (dose.status.isOpen) {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.md)) {
                Button(
                    onClick = { onCheckIn(dose.id, "taken", null) },
                    enabled = !isWorking,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) { Text(strings.taken) }

                TextButton(
                    // Long enough to be a real "not now", short enough to still
                    // be today.
                    onClick = { onCheckIn(dose.id, "snooze", 30) },
                    enabled = !isWorking,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) { Text(strings.snooze) }

                TextButton(
                    onClick = { onCheckIn(dose.id, "skipped", null) },
                    enabled = !isWorking,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) { Text(strings.skipped) }
            }
        }
    }
}

@Composable
private fun MedicationRow(entry: MedicationView, strings: MedicationStrings) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        Text(entry.medication.drugName, color = klinikColor("textPrimary"))
        Text("${entry.medication.dose} · ${entry.schedule}", color = klinikColor("textSecondary"))

        // A medication the patient added themselves does nothing until a
        // clinician approves it. Saying so is the difference between "the
        // clinic knows" and "the clinic has been told".
        if (entry.medication.awaitingApproval) {
            Text(strings.awaitingApproval, color = klinikColor("warning"))
        }

        if (entry.medication.stoppedAt != null) {
            Text(strings.stopped, color = klinikColor("textSecondary"))
        }
    }
}

@Composable
private fun tintFor(status: DoseStatus) = when (status) {
    DoseStatus.TAKEN -> klinikColor("success")
    DoseStatus.LATE -> klinikColor("warning")
    DoseStatus.SKIPPED -> klinikColor("textSecondary")
    DoseStatus.PENDING, DoseStatus.SNOOZED -> klinikColor("info")
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(Tokens.Spacing.xl),
        contentAlignment = Alignment.Center,
    ) { content() }
}
