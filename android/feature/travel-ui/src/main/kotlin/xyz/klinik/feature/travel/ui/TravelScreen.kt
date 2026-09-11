package xyz.klinik.feature.travel.ui

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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.travel.TravelPhase
import xyz.klinik.feature.travel.TravelState
import xyz.klinik.network.TravelPlan
import xyz.klinik.network.UiText
import xyz.klinik.network.UpsertTravelPlan

/** Text the screen needs, resolved by the caller from string resources. */
data class TravelStrings(
    val title: String,
    val noneForPatient: String,
    val emptyForStaff: String,
    val fillIn: String,
    val retry: String,
    val save: String,
    val cancel: String,
    val flights: String,
    val arrivalFlight: String,
    val arrivalAt: String,
    val departureFlight: String,
    val departureAt: String,
    val hotel: String,
    val hotelName: String,
    val hotelAddress: String,
    val checkIn: String,
    val checkOut: String,
    val welcome: String,
    val greeter: String,
    val greeterPhone: String,
    val transfer: String,
    val interpreter: String,
    val interpreterName: String,
    val interpreterLanguage: String,
    val interpreterPhone: String,
    val clearanceToggle: String,
    val clearedToFly: String,
    val notClearedToFly: String,
    /** "Onaylayan: %1$s · %2$s" — who signed it off, and when. */
    val clearedBy: (who: String, at: String) -> String,
    val message: (UiText) -> String,
)

/**
 * Getting the patient here and home again (spec M14).
 *
 * Two audiences, one screen. A patient reads it: which flight, which hotel,
 * who is meeting them, and whether their doctor has said they may fly home.
 * A coordinator edits it — all of it except that last line, which belongs to
 * a clinician and has its own switch.
 *
 * The clearance is stated either way. "Your doctor has not signed this off
 * yet" and a blank space are different things, and only the first is an
 * answer.
 */
@Composable
fun TravelScreen(
    state: TravelState,
    strings: TravelStrings,
    /** False on the patient's own copy, which nobody edits from the app. */
    canEdit: Boolean,
    /** A clinical decision; a coordinator holds the first and not the second. */
    canClearToFly: Boolean,
    onBeginEditing: () -> Unit,
    onCancelEditing: () -> Unit,
    onEdit: (UpsertTravelPlan.() -> UpsertTravelPlan) -> Unit,
    onSave: () -> Unit,
    onSetClearedToFly: (Boolean) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            TravelPhase.Loading -> Centered { CircularProgressIndicator() }

            is TravelPhase.Failed -> Centered {
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

            TravelPhase.None -> if (state.editing) {
                Form(state, strings, onEdit, onSave, onCancelEditing)
            } else {
                Centered {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        // A patient is told the clinic has not filled it in;
                        // staff are told to fill it in. The same emptiness,
                        // two different next steps.
                        Text(
                            if (canEdit) strings.emptyForStaff else strings.noneForPatient,
                            color = klinikColor("textSecondary"),
                            textAlign = TextAlign.Center,
                        )

                        if (canEdit) {
                            Button(
                                onClick = onBeginEditing,
                                modifier = Modifier
                                    .padding(top = Tokens.Spacing.lg)
                                    .heightIn(min = Tokens.minimumTouchTarget),
                            ) {
                                Text(strings.fillIn)
                            }
                        }
                    }
                }
            }

            TravelPhase.Loaded -> if (state.editing) {
                Form(state, strings, onEdit, onSave, onCancelEditing)
            } else {
                Details(state, strings, canEdit, canClearToFly, onBeginEditing, onSetClearedToFly)
            }
        }
    }
}

@Composable
private fun Details(
    state: TravelState,
    strings: TravelStrings,
    canEdit: Boolean,
    canClearToFly: Boolean,
    onBeginEditing: () -> Unit,
    onSetClearedToFly: (Boolean) -> Unit,
) {
    val plan = state.plan ?: return

    Column(
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

        state.error?.let { Text(strings.message(it), color = klinikColor("critical")) }

        Clearance(state, strings, canClearToFly, onSetClearedToFly)

        Section(strings.flights) {
            Field(strings.arrivalFlight, plan.arrivalFlight)
            Field(strings.arrivalAt, plan.arrivalAt?.take(16)?.replace('T', ' '))
            Field(strings.departureFlight, plan.departureFlight)
            Field(strings.departureAt, plan.departureAt?.take(16)?.replace('T', ' '))
        }

        Section(strings.hotel) {
            Field(strings.hotelName, plan.hotelName)
            Field(strings.hotelAddress, plan.hotelAddress)
            Field(strings.checkIn, plan.hotelCheckIn)
            Field(strings.checkOut, plan.hotelCheckOut)
        }

        Section(strings.welcome) {
            Field(strings.greeter, plan.greeterName)
            Field(strings.greeterPhone, plan.greeterPhone)
            Field(strings.transfer, plan.transferNote)
        }

        Section(strings.interpreter) {
            Field(strings.interpreterName, plan.interpreterName)
            Field(strings.interpreterLanguage, plan.interpreterLanguage)
            Field(strings.interpreterPhone, plan.interpreterPhone)
        }

        if (canEdit) {
            Button(
                onClick = onBeginEditing,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(strings.fillIn)
            }
        }
    }
}

/**
 * The one clinical line on a logistical screen.
 *
 * Said either way: "your doctor has not signed this off yet" and a blank space
 * are different things, and only one of them is an answer to somebody about to
 * book a flight.
 */
@Composable
private fun Clearance(
    state: TravelState,
    strings: TravelStrings,
    canClearToFly: Boolean,
    onSetClearedToFly: (Boolean) -> Unit,
) {
    Surface(
        color = if (state.isClearedToFly) {
            klinikColor("successSurface")
        } else {
            klinikColor("warningSurface")
        },
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
        ) {
            Text(
                if (state.isClearedToFly) strings.clearedToFly else strings.notClearedToFly,
                color = if (state.isClearedToFly) {
                    klinikColor("success")
                } else {
                    klinikColor("warning")
                },
            )

            // Who signed it, so the decision has a name on it rather than
            // being something the app appears to have decided.
            val who = state.clearedBy
            val at = state.plan?.clearedToFlyAt

            if (who != null && at != null) {
                Text(
                    strings.clearedBy(who, at.take(10)),
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("textSecondary"),
                )
            }

            if (canClearToFly) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = Tokens.minimumTouchTarget),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Switch(
                        checked = state.isClearedToFly,
                        onCheckedChange = onSetClearedToFly,
                        enabled = !state.busy,
                    )
                    Text(
                        strings.clearanceToggle,
                        color = klinikColor("textPrimary"),
                        modifier = Modifier.padding(start = Tokens.Spacing.sm),
                    )
                }
            }
        }
    }
}

@Composable
private fun Form(
    state: TravelState,
    strings: TravelStrings,
    onEdit: (UpsertTravelPlan.() -> UpsertTravelPlan) -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
) {
    val draft = state.draft

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Tokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.md),
    ) {
        state.error?.let { Text(strings.message(it), color = klinikColor("critical")) }

        Entry(strings.arrivalFlight, draft.arrivalFlight) { onEdit { copy(arrivalFlight = it) } }
        Entry(strings.arrivalAt, draft.arrivalAt) { onEdit { copy(arrivalAt = it) } }
        Entry(strings.departureFlight, draft.departureFlight) {
            onEdit { copy(departureFlight = it) }
        }
        Entry(strings.departureAt, draft.departureAt) { onEdit { copy(departureAt = it) } }
        Entry(strings.hotelName, draft.hotelName) { onEdit { copy(hotelName = it) } }
        Entry(strings.hotelAddress, draft.hotelAddress) { onEdit { copy(hotelAddress = it) } }
        Entry(strings.checkIn, draft.hotelCheckIn) { onEdit { copy(hotelCheckIn = it) } }
        Entry(strings.checkOut, draft.hotelCheckOut) { onEdit { copy(hotelCheckOut = it) } }
        Entry(strings.greeter, draft.greeterName) { onEdit { copy(greeterName = it) } }
        Entry(strings.greeterPhone, draft.greeterPhone) { onEdit { copy(greeterPhone = it) } }
        Entry(strings.transfer, draft.transferNote) { onEdit { copy(transferNote = it) } }
        Entry(strings.interpreterName, draft.interpreterName) {
            onEdit { copy(interpreterName = it) }
        }
        Entry(strings.interpreterLanguage, draft.interpreterLanguage) {
            onEdit { copy(interpreterLanguage = it) }
        }
        Entry(strings.interpreterPhone, draft.interpreterPhone) {
            onEdit { copy(interpreterPhone = it) }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
            Button(
                onClick = onSave,
                enabled = !state.busy,
                modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(strings.save)
            }

            TextButton(
                onClick = onCancel,
                enabled = !state.busy,
                modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(strings.cancel)
            }
        }
    }
}

@Composable
private fun Entry(label: String, value: String?, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value.orEmpty(),
        onValueChange = onChange,
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth(),
    )
}

/** A row that is not drawn at all when there is nothing in it. */
@Composable
private fun Field(label: String, value: String?) {
    if (value.isNullOrBlank()) return

    Row(modifier = Modifier.fillMaxWidth()) {
        Text(label, color = klinikColor("textSecondary"), modifier = Modifier.weight(1f))
        Text(value, color = klinikColor("textPrimary"))
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
