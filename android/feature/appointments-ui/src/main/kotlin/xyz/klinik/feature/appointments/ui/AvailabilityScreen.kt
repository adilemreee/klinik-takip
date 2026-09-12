package xyz.klinik.feature.appointments.ui

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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
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
import androidx.compose.ui.text.style.TextAlign
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.appointments.AvailabilityPhase
import xyz.klinik.feature.appointments.AvailabilityState
import xyz.klinik.network.AvailabilityWindow
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class AvailabilityStrings(
    val title: String,
    val explain: String,
    val retry: String,
    val noneTitle: String,
    val noneDetail: String,
    val noProfile: String,
    val day: String,
    val dayName: (Int) -> String,
    val from: String,
    val to: String,
    val add: String,
    val open: String,
    val paused: String,
    val withdraw: String,
    val withdrawTitle: String,
    val withdrawDetail: String,
    val cancel: String,
    val message: (UiText) -> String,
)

/**
 * When a clinician can be booked (spec M3).
 *
 * A week, not a calendar. The empty state says out loud that nobody can book
 * this person — a blank list otherwise looks like a free diary, which is the
 * opposite of what it means.
 *
 * Switching a window off and removing it are different buttons because they
 * are different decisions: one is a week away with the pattern intact, the
 * other loses it. Neither cancels appointments already in that window, and the
 * confirmation says so — a clinician who believed otherwise would not turn up.
 */
@Composable
fun AvailabilityScreen(
    state: AvailabilityState,
    strings: AvailabilityStrings,
    onAdd: (day: Int, from: String, to: String) -> Unit,
    onSetOpen: (AvailabilityWindow, Boolean) -> Unit,
    onRemove: (AvailabilityWindow) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var removing by remember { mutableStateOf<AvailabilityWindow?>(null) }

    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            AvailabilityPhase.Loading -> Centered { CircularProgressIndicator() }

            // Working hours belong to a clinician, not to a login.
            AvailabilityPhase.NoProfile -> Centered {
                Text(
                    strings.noProfile,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            is AvailabilityPhase.Failed -> Centered {
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

            AvailabilityPhase.None, AvailabilityPhase.Loaded -> Column(
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

                Text(strings.explain, color = klinikColor("textSecondary"))

                state.error?.let {
                    Text(strings.message(it), color = klinikColor("critical"))
                }

                if (state.phase == AvailabilityPhase.None) {
                    // Said as a consequence, not as an empty list: a blank
                    // week looks like a free diary and means the opposite.
                    Surface(
                        color = klinikColor("warningSurface"),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(
                            modifier = Modifier.padding(Tokens.Spacing.lg),
                            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
                        ) {
                            Text(strings.noneTitle, color = klinikColor("warning"))
                            Text(
                                strings.noneDetail,
                                fontSize = Tokens.Typography.caption.size,
                                color = klinikColor("textSecondary"),
                            )
                        }
                    }
                }

                AddWindow(state, strings, onAdd)

                state.byDay.forEach { (day, windows) ->
                    Section(strings.dayName(day)) {
                        windows.forEach { window ->
                            WindowRow(window, state, strings, onSetOpen) { removing = it }
                        }
                    }
                }
            }
        }
    }

    removing?.let { window ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text(strings.withdrawTitle) },
            // What removing does and — as importantly — what it does not:
            // appointments already booked in this window stay in the diary.
            text = { Text(strings.withdrawDetail) },
            confirmButton = {
                TextButton(
                    onClick = {
                        onRemove(window)
                        removing = null
                    },
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.withdraw)
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { removing = null },
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.cancel)
                }
            },
        )
    }
}

@Composable
private fun AddWindow(
    state: AvailabilityState,
    strings: AvailabilityStrings,
    onAdd: (Int, String, String) -> Unit,
) {
    var day by remember { mutableStateOf(1) }
    var from by remember { mutableStateOf("09:00") }
    var to by remember { mutableStateOf("17:00") }

    Section(strings.add) {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
            Text(
                strings.day,
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
            )

            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
            ) {
                // Monday first, Sunday last: the week as a person reads it.
                (listOf(1, 2, 3, 4, 5, 6, 0)).forEach { option ->
                    FilterChip(
                        selected = option == day,
                        onClick = { day = option },
                        label = { Text(strings.dayName(option)) },
                        modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                    )
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
            OutlinedTextField(
                value = from,
                onValueChange = { from = it },
                label = { Text(strings.from) },
                modifier = Modifier.weight(1f),
            )
            OutlinedTextField(
                value = to,
                onValueChange = { to = it },
                label = { Text(strings.to) },
                modifier = Modifier.weight(1f),
            )
        }

        Button(
            onClick = { onAdd(day, from, to) },
            enabled = state.busyId == null,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Tokens.minimumTouchTarget),
        ) {
            Text(strings.add)
        }
    }
}

@Composable
private fun WindowRow(
    window: AvailabilityWindow,
    state: AvailabilityState,
    strings: AvailabilityStrings,
    onSetOpen: (AvailabilityWindow, Boolean) -> Unit,
    onRemove: (AvailabilityWindow) -> Unit,
) {
    val busy = state.busyId == window.id

    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = Tokens.minimumTouchTarget),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text("${window.startTime} – ${window.endTime}", color = klinikColor("textPrimary"))

            // In a word as well as a switch position, because a switch a
            // reader cannot see the state of says nothing.
            Text(
                if (window.isActive) strings.open else strings.paused,
                fontSize = Tokens.Typography.caption.size,
                color = if (window.isActive) {
                    klinikColor("success")
                } else {
                    klinikColor("textSecondary")
                },
            )
        }

        Switch(
            checked = window.isActive,
            onCheckedChange = { open -> onSetOpen(window, open) },
            enabled = !busy,
        )

        TextButton(
            onClick = { onRemove(window) },
            enabled = !busy,
            modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
        ) {
            Text(strings.withdraw)
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
