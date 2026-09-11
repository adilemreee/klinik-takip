package xyz.klinik.feature.patients.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.patients.NewPatientProblem
import xyz.klinik.feature.patients.NewPatientState
import xyz.klinik.network.Patient
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class NewPatientStrings(
    val title: String,
    val firstName: String,
    val lastName: String,
    val birthDate: String,
    val sex: String,
    val sexName: (String) -> String,
    val country: String,
    val city: String,
    val referral: String,
    val create: String,
    val created: String,
    val fileNumber: String,
    val problem: (NewPatientProblem) -> String,
    val message: (UiText) -> String,
)

/**
 * Opening a file (spec M2).
 *
 * An identity and nothing clinical. What was operated on and when belongs to
 * the record; asking for it at the moment somebody writes a name down would
 * make opening a file slower than it needs to be, and half the fields would be
 * guesses.
 *
 * The five the server requires are refused here first, while somebody types —
 * a rejection arriving from the network on a filled-in form reads as the app
 * being broken.
 */
@Composable
fun NewPatientScreen(
    state: NewPatientState,
    strings: NewPatientStrings,
    onEdit: (xyz.klinik.feature.patients.NewPatientDraft.() -> xyz.klinik.feature.patients.NewPatientDraft) -> Unit,
    onCreate: () -> Unit,
    onOpenFile: (Patient) -> Unit,
    modifier: Modifier = Modifier,
) {
    val draft = state.draft

    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.md),
        ) {
            Text(
                strings.title,
                fontSize = Tokens.Typography.heading.size,
                fontWeight = Tokens.Typography.heading.weight,
                color = klinikColor("textPrimary"),
                modifier = Modifier.semantics { heading() },
            )

            state.created?.let { patient ->
                // The file number the server assigned, and a way straight into
                // the record: somebody who has just opened a file is about to
                // put something in it.
                Surface(color = klinikColor("successSurface"), modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(Tokens.Spacing.lg),
                        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
                    ) {
                        Text(strings.created, color = klinikColor("success"))
                        Text(
                            "${strings.fileNumber}: ${patient.mrn}",
                            color = klinikColor("textPrimary"),
                        )
                        Button(
                            onClick = { onOpenFile(patient) },
                            modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                        ) {
                            Text(patient.fullName)
                        }
                    }
                }

                return@Column
            }

            state.error?.let {
                Text(strings.message(it), color = klinikColor("critical"))
            }

            OutlinedTextField(
                value = draft.firstName,
                onValueChange = { value -> onEdit { copy(firstName = value) } },
                label = { Text(strings.firstName) },
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = draft.lastName,
                onValueChange = { value -> onEdit { copy(lastName = value) } },
                label = { Text(strings.lastName) },
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = draft.birthDate,
                onValueChange = { value -> onEdit { copy(birthDate = value) } },
                label = { Text(strings.birthDate) },
                modifier = Modifier.fillMaxWidth(),
            )

            Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
                Text(
                    strings.sex,
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("textSecondary"),
                )

                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
                ) {
                    listOf("FEMALE", "MALE", "OTHER", "UNDISCLOSED").forEach { option ->
                        FilterChip(
                            selected = option == draft.sex,
                            onClick = { onEdit { copy(sex = option) } },
                            label = { Text(strings.sexName(option)) },
                            modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                        )
                    }
                }
            }

            OutlinedTextField(
                value = draft.country,
                onValueChange = { value -> onEdit { copy(country = value) } },
                label = { Text(strings.country) },
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = draft.city,
                onValueChange = { value -> onEdit { copy(city = value) } },
                label = { Text(strings.city) },
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = draft.referralSource,
                onValueChange = { value -> onEdit { copy(referralSource = value) } },
                label = { Text(strings.referral) },
                modifier = Modifier.fillMaxWidth(),
            )

            // Said while typing, not after the server refuses.
            state.problems.forEach { problem ->
                Text(
                    strings.problem(problem),
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("warning"),
                )
            }

            Button(
                onClick = onCreate,
                enabled = state.canSubmit,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(strings.create)
            }
        }
    }
}
