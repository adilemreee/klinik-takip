package xyz.klinik.feature.finance.ui

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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.text.input.KeyboardType
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.finance.AgencyPhase
import xyz.klinik.feature.finance.AgencyState
import xyz.klinik.network.Agency
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class AgencyStrings(
    val title: String,
    val empty: String,
    val retry: String,
    val add: String,
    val name: String,
    val contact: String,
    val email: String,
    val phone: String,
    val country: String,
    val commission: String,
    val commissionHint: String,
    val inactive: String,
    val save: String,
    val message: (UiText) -> String,
)

/**
 * Who sends the clinic patients, and on what commission (spec M11).
 *
 * The rate is typed as a percentage, because that is the number a person says
 * out loud, and the hint under the box says exactly what "10" will mean on an
 * invoice. The conversion to the fraction the server stores happens out of
 * sight — getting it backwards would multiply a commission by a hundred.
 *
 * An agency is switched off rather than deleted. Its invoices keep the
 * commission they were written with, and a record that vanished would leave
 * those naming something nobody can look up.
 */
@Composable
fun AgencyScreen(
    state: AgencyState,
    strings: AgencyStrings,
    onAdd: (
        name: String,
        country: String,
        contactName: String,
        email: String,
        phone: String,
        commissionPercent: Int?,
    ) -> Unit,
    onSetActive: (Agency, Boolean) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            AgencyPhase.Loading -> Centered { CircularProgressIndicator() }

            is AgencyPhase.Failed -> Centered {
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

            AgencyPhase.Empty, AgencyPhase.Loaded -> Column(
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

                AddAgency(state, strings, onAdd)

                if (state.phase == AgencyPhase.Empty) {
                    Text(strings.empty, color = klinikColor("textSecondary"))
                }

                state.active.forEach { agency -> AgencyRow(agency, state, strings, onSetActive) }

                if (state.inactive.isNotEmpty()) {
                    Section(strings.inactive) {
                        state.inactive.forEach { agency ->
                            AgencyRow(agency, state, strings, onSetActive)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AddAgency(
    state: AgencyState,
    strings: AgencyStrings,
    onAdd: (String, String, String, String, String, Int?) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var country by remember { mutableStateOf("") }
    var contact by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var commission by remember { mutableStateOf("") }

    Section(strings.add) {
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text(strings.name) },
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = country,
            onValueChange = { country = it },
            label = { Text(strings.country) },
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = contact,
            onValueChange = { contact = it },
            label = { Text(strings.contact) },
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text(strings.email) },
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = phone,
            onValueChange = { phone = it },
            label = { Text(strings.phone) },
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = commission,
            onValueChange = { commission = it.filter(Char::isDigit) },
            label = { Text(strings.commission) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )

        // What "10" will do to an invoice, said beside the box rather than
        // left for somebody to find out on the first commission run.
        Text(
            strings.commissionHint,
            fontSize = Tokens.Typography.caption.size,
            color = klinikColor("textSecondary"),
        )

        Button(
            onClick = {
                onAdd(name, country, contact, email, phone, commission.toIntOrNull())
                name = ""
                country = ""
                contact = ""
                email = ""
                phone = ""
                commission = ""
            },
            enabled = name.isNotBlank() && state.busyId == null,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Tokens.minimumTouchTarget),
        ) {
            Text(strings.save)
        }
    }
}

@Composable
private fun AgencyRow(
    agency: Agency,
    state: AgencyState,
    strings: AgencyStrings,
    onSetActive: (Agency, Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = Tokens.minimumTouchTarget)
            .padding(vertical = Tokens.Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(agency.name, color = klinikColor("textPrimary"))

            Text(
                buildString {
                    agency.country?.let { append(it) }

                    // Null and zero are different arrangements, and only one
                    // of them takes money off an invoice.
                    agency.commissionPercent?.let {
                        if (isNotEmpty()) append(" · ")
                        append("%$it")
                    }
                },
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
            )
        }

        Switch(
            checked = agency.isActive,
            onCheckedChange = { active -> onSetActive(agency, active) },
            enabled = state.busyId == null,
        )
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
