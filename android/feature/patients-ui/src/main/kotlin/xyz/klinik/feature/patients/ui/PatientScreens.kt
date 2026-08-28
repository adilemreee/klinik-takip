package xyz.klinik.feature.patients.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.patients.DetailPhase
import xyz.klinik.feature.patients.ListPhase
import xyz.klinik.feature.patients.PatientListState
import xyz.klinik.network.Patient

/** Text the screens need, resolved by the caller from string resources. */
data class PatientStrings(
    val searchHint: String,
    val empty: String,
    val fileNumber: String,
    val retry: String,
    val loading: String,
    val notFound: String,
    val country: String,
    val city: String,
)

/**
 * The staff-side patient list.
 *
 * Search runs on every keystroke: the model drops answers for queries the user
 * has moved past, so a fast typist cannot end up looking at stale results.
 */
@Composable
fun PatientListScreen(
    state: PatientListState,
    strings: PatientStrings,
    query: String,
    onQueryChange: (String) -> Unit,
    onSelect: (Patient) -> Unit,
    onLoadMore: () -> Unit,
    onRetry: () -> Unit,
) {
    Surface(color = klinikColor("background"), modifier = Modifier.fillMaxSize()) {
        Column {
            OutlinedTextField(
                value = query,
                onValueChange = onQueryChange,
                singleLine = true,
                label = { Text(strings.searchHint) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(Tokens.Spacing.lg)
                    .heightIn(min = Tokens.minimumTouchTarget),
            )

            when (val phase = state.phase) {
                ListPhase.Idle, ListPhase.LoadingFirstPage -> Centered {
                    CircularProgressIndicator()
                }

                ListPhase.Empty -> MessageState(strings.empty)

                is ListPhase.Failed -> MessageState(
                    text = phase.messageKey,
                    retryTitle = strings.retry,
                    onRetry = onRetry,
                )

                ListPhase.Loaded -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(state.patients, key = { it.id }) { patient ->
                        PatientRow(patient, strings) { onSelect(patient) }
                    }

                    if (state.hasMore) {
                        item {
                            // Fetching when the footer scrolls into view rather
                            // than making the user find a button.
                            LaunchedEffect(state.patients.size) { onLoadMore() }
                            Centered { CircularProgressIndicator() }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PatientRow(patient: Patient, strings: PatientStrings, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = Tokens.minimumTouchTarget)
            .padding(horizontal = Tokens.Spacing.lg, vertical = Tokens.Spacing.xs),
    ) {
        Column(
            horizontalAlignment = Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(patient.fullName, fontSize = Tokens.Typography.subheading.size)
            Text(
                "${strings.fileNumber} ${patient.mrn} · ${patient.country}",
                fontSize = Tokens.Typography.caption.size,
            )
        }
    }
}

/** One patient's file. */
@Composable
fun PatientDetailScreen(phase: DetailPhase, strings: PatientStrings, onRetry: () -> Unit) {
    Surface(color = klinikColor("background"), modifier = Modifier.fillMaxSize()) {
        when (phase) {
            DetailPhase.Loading -> Centered { CircularProgressIndicator() }

            // Deliberately the same message a genuinely missing record gets:
            // saying "no access" would confirm the file exists.
            DetailPhase.NotFound -> MessageState(strings.notFound)

            is DetailPhase.Failed -> MessageState(
                text = phase.messageKey,
                retryTitle = strings.retry,
                onRetry = onRetry,
            )

            is DetailPhase.Loaded -> Column(
                verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
                modifier = Modifier.padding(Tokens.Spacing.xl),
            ) {
                Text(
                    phase.patient.fullName,
                    fontSize = Tokens.Typography.title.size,
                    fontWeight = Tokens.Typography.title.weight,
                    color = klinikColor("textPrimary"),
                    modifier = Modifier.semantics { heading() },
                )

                DetailRow(strings.fileNumber, phase.patient.mrn)
                DetailRow(strings.country, phase.patient.country)
                phase.patient.city?.let { DetailRow(strings.city, it) }
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    // One announcement per row rather than two fragments.
    Column(
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
        modifier = Modifier.clearAndSetSemantics {},
    ) {
        Text(label, fontSize = Tokens.Typography.caption.size, color = klinikColor("textSecondary"))
        Text(value, fontSize = Tokens.Typography.body.size, color = klinikColor("textPrimary"))
    }
}

/**
 * Empty and error states share a shape: an explanation and, when the situation
 * is retryable, one action. Spec section 7 asks for both to be designed rather
 * than left as a blank screen.
 */
@Composable
private fun MessageState(text: String, retryTitle: String? = null, onRetry: (() -> Unit)? = null) {
    Centered {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
        ) {
            Text(text, color = klinikColor("textSecondary"), fontSize = Tokens.Typography.body.size)

            if (retryTitle != null && onRetry != null) {
                Button(
                    onClick = onRetry,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(retryTitle)
                }
            }
        }
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.xxl),
    ) {
        content()
    }
}
