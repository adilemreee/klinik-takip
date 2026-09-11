package xyz.klinik.feature.medications.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.medications.PrescribingPhase
import xyz.klinik.feature.medications.PrescribingState
import xyz.klinik.feature.medications.Schedule
import xyz.klinik.network.InteractionCheck
import xyz.klinik.network.InteractionSeverity
import xyz.klinik.network.MedicationView
import xyz.klinik.network.Prescription
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class PrescribingStrings(
    val title: String,
    val empty: String,
    val retry: String,
    val prescribed: String,
    val awaitingApproval: String,
    val stopped: String,
    val approve: String,
    val stop: String,
    val nextDose: String,
    val interactionsTitle: String,
    val interactionDisclaimer: String,
    val interactionNone: String,
    val interactionNotChecked: String,
    val interactionUnrecognised: String,
    val severityName: (InteractionSeverity) -> String,
    val newTitle: String,
    val drugName: String,
    val dose: String,
    val form: String,
    val instructions: String,
    val timesPerDay: String,
    val days: String,
    val write: String,
    val needName: String,
    /** "Günde %1$d kez, %2$d gün — toplam %3$d doz. Saatler: %4$s". */
    val summary: (times: Int, days: Int, total: Int, hours: String) -> String,
    val message: (UiText) -> String,
)

/**
 * The clinician's side of the medication module (spec M9).
 *
 * The interaction check is above the form, not under it: a doctor opening this
 * screen is often opening it to decide whether to add something, and a warning
 * that appears after the prescription is written is a warning that arrived too
 * late. It says plainly when nothing was compared — an empty warning list
 * beside three unrecognised drugs is not a clean bill of health, and reading
 * it as one is how software misleads somebody.
 *
 * The schedule is entered as "twice a day for eight days" and turned into the
 * RRULE the server stores. The sentence under the form is what a clinician
 * checks before it becomes sixteen alarms on somebody's phone.
 */
@Composable
fun PrescribingScreen(
    state: PrescribingState,
    strings: PrescribingStrings,
    onPrescribe: (Prescription) -> Unit,
    onApprove: (MedicationView) -> Unit,
    onStop: (MedicationView) -> Unit,
    onRetry: () -> Unit,
    /** The patient's zone: a dose is a wall-clock event, not an instant. */
    timezone: String,
    todayIso: String,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            PrescribingPhase.Loading -> Centered { CircularProgressIndicator() }

            is PrescribingPhase.Failed -> Centered {
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

            PrescribingPhase.Empty, PrescribingPhase.Loaded -> Column(
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

                state.error?.let {
                    Text(strings.message(it), color = klinikColor("critical"))
                }

                Interactions(state.interactions, strings)

                PrescriptionForm(state, strings, timezone, todayIso, onPrescribe)

                if (state.awaitingApproval.isNotEmpty()) {
                    Section(strings.awaitingApproval) {
                        state.awaitingApproval.forEach { view ->
                            MedicationRow(view, state, strings, onApprove, onStop)
                        }
                    }
                }

                Section(strings.prescribed) {
                    if (state.active.isEmpty()) {
                        Text(strings.empty, color = klinikColor("textSecondary"))
                    }

                    state.active.forEach { view ->
                        MedicationRow(view, state, strings, onApprove, onStop)
                    }
                }

                if (state.stopped.isNotEmpty()) {
                    Section(strings.stopped) {
                        state.stopped.forEach { view ->
                            MedicationRow(view, state, strings, onApprove, onStop)
                        }
                    }
                }
            }
        }
    }
}

/**
 * What the reference says, and what it could not say.
 *
 * Both halves matter. "No known interaction" and "nothing was compared" look
 * identical if only the warnings are drawn.
 */
@Composable
private fun Interactions(check: InteractionCheck?, strings: PrescribingStrings) {
    if (check == null) return

    Section(strings.interactionsTitle) {
        when {
            !check.checkedAnything -> Text(
                strings.interactionNotChecked,
                color = klinikColor("warning"),
            )

            check.warnings.isEmpty() -> Text(
                strings.interactionNone,
                color = klinikColor("textSecondary"),
            )
        }

        check.warnings.forEach { warning ->
            Column(modifier = Modifier.fillMaxWidth().padding(vertical = Tokens.Spacing.xxs)) {
                Text(
                    strings.severityName(warning.severity),
                    color = if (warning.severity.isSevere) {
                        klinikColor("critical")
                    } else {
                        klinikColor("warning")
                    },
                    fontWeight = Tokens.Typography.subheading.weight,
                )
                Text(warning.note, color = klinikColor("textPrimary"))

                // Which two drugs, in the clinician's own words: a severity
                // with no pair beside it is a warning nobody can act on.
                if (warning.between.isNotEmpty()) {
                    Text(
                        warning.between.joinToString(" + ") { it.drugName },
                        fontSize = Tokens.Typography.caption.size,
                        color = klinikColor("textSecondary"),
                    )
                }
            }
        }

        if (check.unrecognised.isNotEmpty()) {
            // Named, because an empty warning list beside three drugs the
            // reference never saw is not a clean bill of health.
            Text(strings.interactionUnrecognised, color = klinikColor("warning"))

            check.unrecognised.forEach { drug ->
                Text(
                    drug.drugName,
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("textSecondary"),
                )
            }
        }

        // Under every answer, including the empty one.
        Text(
            strings.interactionDisclaimer,
            fontSize = Tokens.Typography.footnote.size,
            color = klinikColor("textSecondary"),
        )
    }
}

@Composable
private fun PrescriptionForm(
    state: PrescribingState,
    strings: PrescribingStrings,
    timezone: String,
    todayIso: String,
    onPrescribe: (Prescription) -> Unit,
) {
    var drugName by remember { mutableStateOf("") }
    var dose by remember { mutableStateOf("") }
    var form by remember { mutableStateOf("") }
    var instructions by remember { mutableStateOf("") }
    var timesPerDay by remember { mutableStateOf(2) }
    var days by remember { mutableStateOf(7) }

    val schedule = remember(timesPerDay, days) { Schedule(timesPerDay, days) }
    val complete = drugName.isNotBlank() && dose.isNotBlank()

    Section(strings.newTitle) {
        OutlinedTextField(
            value = drugName,
            onValueChange = { drugName = it },
            label = { Text(strings.drugName) },
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = dose,
            onValueChange = { dose = it },
            label = { Text(strings.dose) },
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = form,
            onValueChange = { form = it },
            label = { Text(strings.form) },
            modifier = Modifier.fillMaxWidth(),
        )

        Steps(strings.timesPerDay, 1..4, timesPerDay) { timesPerDay = it }
        Steps(strings.days, listOf(3, 5, 7, 10, 14, 30), days) { days = it }

        OutlinedTextField(
            value = instructions,
            onValueChange = { instructions = it },
            label = { Text(strings.instructions) },
            modifier = Modifier.fillMaxWidth(),
        )

        // What was actually written, in words, before it becomes alarms.
        Text(
            strings.summary(
                schedule.timesPerDay,
                schedule.days,
                schedule.totalDoses,
                schedule.displayHours,
            ),
            color = klinikColor("textSecondary"),
        )

        if (!complete) {
            Text(
                strings.needName,
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
            )
        }

        Button(
            onClick = {
                onPrescribe(
                    Prescription(
                        drugName = drugName.trim(),
                        dose = dose.trim(),
                        form = form.trim().ifEmpty { null },
                        frequencyRule = schedule.rule,
                        startDate = todayIso,
                        startTime = schedule.startTime,
                        timezone = timezone,
                        instructions = instructions.trim().ifEmpty { null },
                    ),
                )
                drugName = ""
                dose = ""
                form = ""
                instructions = ""
            },
            enabled = complete && state.busyId == null,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Tokens.minimumTouchTarget),
        ) {
            Text(strings.write)
        }
    }
}

@Composable
private fun Steps(label: String, options: Iterable<Int>, chosen: Int, onChoose: (Int) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        Text(
            label,
            fontSize = Tokens.Typography.caption.size,
            color = klinikColor("textSecondary"),
        )

        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
        ) {
            options.forEach { option ->
                FilterChip(
                    selected = option == chosen,
                    onClick = { onChoose(option) },
                    label = { Text(option.toString()) },
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                )
            }
        }
    }
}

@Composable
private fun MedicationRow(
    view: MedicationView,
    state: PrescribingState,
    strings: PrescribingStrings,
    onApprove: (MedicationView) -> Unit,
    onStop: (MedicationView) -> Unit,
) {
    val medication = view.medication
    val busy = state.busyId == medication.id

    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = Tokens.Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
    ) {
        Text("${medication.drugName} · ${medication.dose}", color = klinikColor("textPrimary"))

        // The rule in a sentence, so a clinician can check what was written
        // rather than reading an RRULE.
        Text(
            view.schedule,
            fontSize = Tokens.Typography.caption.size,
            color = klinikColor("textSecondary"),
        )

        view.nextDose?.let {
            Text(
                "${strings.nextDose}: ${it.take(16).replace('T', ' ')}",
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
            if (medication.awaitingApproval) {
                Button(
                    onClick = { onApprove(view) },
                    enabled = !busy,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.approve)
                }
            }

            if (medication.stoppedAt == null) {
                TextButton(
                    onClick = { onStop(view) },
                    enabled = !busy,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.stop)
                }
            }
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
private fun Centered(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.xl),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { content() }
    }
}
