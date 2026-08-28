package xyz.klinik.feature.measurements.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.measurements.DecimalEntry
import xyz.klinik.feature.measurements.MeasurementsState
import xyz.klinik.network.MeasurementType
import xyz.klinik.network.NewMeasurement
import xyz.klinik.network.UiText

/** Text the entry form needs, resolved by the caller from string resources. */
data class RecordStrings(
    val title: String,
    val save: String,
    val cancel: String,
    val note: String,
    val systolic: String,
    val diastolic: String,
    val typeName: (MeasurementType) -> String,
    val message: (String) -> String,
)

/**
 * Entering a reading.
 *
 * The whole set of types is offered rather than only weight: a nurse taking
 * vitals records four numbers in a row, and sending her to a different screen
 * for each one is how readings end up not being recorded at all.
 */
@Composable
fun RecordMeasurementScreen(
    state: MeasurementsState,
    strings: RecordStrings,
    onSave: (NewMeasurement) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var type by remember { mutableStateOf(MeasurementType.WEIGHT) }
    var value by remember { mutableStateOf("") }
    var secondary by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }

    val parsed = DecimalEntry.parse(value)
    val parsedSecondary = DecimalEntry.parse(secondary)
    val canSave = parsed != null && (!type.hasSecondaryValue || parsedSecondary != null)

    Surface(color = klinikColor("background"), modifier = modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
        ) {
            Text(strings.title, color = klinikColor("textPrimary"))

            TypeSelector(type, strings) { type = it }

            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                // Digits plus a separator: 72.4 cannot be typed on a number pad,
                // and a field that silently refuses the separator reads as broken.
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                label = {
                    Text(
                        if (type.hasSecondaryValue) strings.systolic else strings.typeName(type),
                    )
                },
                modifier = Modifier.fillMaxWidth(),
            )

            if (type.hasSecondaryValue) {
                OutlinedTextField(
                    value = secondary,
                    onValueChange = { secondary = it },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    label = { Text(strings.diastolic) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            OutlinedTextField(
                value = note,
                onValueChange = { note = it },
                label = { Text(strings.note) },
                modifier = Modifier.fillMaxWidth(),
            )

            state.saveError?.let { error ->
                val text = when (error) {
                    is UiText.Key -> strings.message(error.key)
                    is UiText.Literal -> error.text
                }

                Text(
                    text,
                    color = klinikColor("critical"),
                    modifier = Modifier.semantics { contentDescription = text },
                )
            }

            Button(
                onClick = {
                    parsed?.let {
                        onSave(
                            NewMeasurement(
                                type = type,
                                value = it,
                                secondaryValue = if (type.hasSecondaryValue) parsedSecondary else null,
                                note = note.ifEmpty { null },
                            ),
                        )
                    }
                },
                enabled = canSave && !state.saving,
                modifier = Modifier.fillMaxWidth().height(Tokens.minimumTouchTarget),
            ) {
                Text(strings.save)
            }

            TextButton(
                onClick = onCancel,
                modifier = Modifier.fillMaxWidth().height(Tokens.minimumTouchTarget),
            ) {
                Text(strings.cancel)
            }
        }
    }
}

@Composable
private fun TypeSelector(
    selected: MeasurementType,
    strings: RecordStrings,
    onSelect: (MeasurementType) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        MeasurementType.entries.forEach { option ->
            if (option == selected) {
                Button(
                    onClick = { onSelect(option) },
                    modifier = Modifier.fillMaxWidth().height(Tokens.minimumTouchTarget),
                ) {
                    Text(strings.typeName(option))
                }
            } else {
                TextButton(
                    onClick = { onSelect(option) },
                    modifier = Modifier.fillMaxWidth().height(Tokens.minimumTouchTarget),
                ) {
                    Text(strings.typeName(option))
                }
            }
        }
    }
}
