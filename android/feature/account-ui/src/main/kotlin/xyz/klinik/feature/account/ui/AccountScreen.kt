package xyz.klinik.feature.account.ui

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
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.account.AccountOutcome
import xyz.klinik.feature.account.AccountPhase
import xyz.klinik.feature.account.AccountState
import xyz.klinik.network.SessionSummary
import xyz.klinik.network.UiText
import xyz.klinik.shell.PasswordRules

/** Text the screen needs, resolved by the caller from string resources. */
data class AccountStrings(
    val title: String,
    val retry: String,
    val security: String,
    val changePassword: String,
    val changePasswordHint: String,
    val currentPassword: String,
    val newPassword: String,
    val passwordChanged: String,
    val twoFactor: String,
    val twoFactorOn: String,
    val twoFactorCode: String,
    val disableTwoFactor: String,
    val disableTwoFactorHint: String,
    val twoFactorDisabled: String,
    val twoFactorMandatory: String,
    val otherDevices: String,
    val noOtherDevices: String,
    val thisDevice: String,
    val unknownDevice: String,
    val lastSeen: (String) -> String,
    val revoke: String,
    val signOutEverywhere: String,
    val signOutEverywhereConfirm: String,
    val dataExport: String,
    val dataExportHint: String,
    val exportRows: (Int) -> String,
    val exportOmitted: String,
    val save: String,
    /** A password rule, with its number already in the sentence. */
    val rule: (PasswordRules.Problem) -> String,
    val message: (UiText) -> String,
)

/**
 * The account somebody signed in with (spec T7.3).
 *
 * Every action on this screen is irreversible in the same way, so each one
 * says what it will do before it does it: changing a password ends every
 * session including this one, and the sentence is above the fields rather than
 * in the confirmation afterwards. The password rules are shown while somebody
 * types, because a rejection that arrives from the network on a form filled in
 * twice reads as the app being broken.
 */
@Composable
fun AccountScreen(
    state: AccountState,
    strings: AccountStrings,
    onChangePassword: (current: String, next: String) -> Unit,
    onDisableTwoFactor: (String) -> Unit,
    onEndSession: (SessionSummary) -> Unit,
    onSignOutEverywhere: () -> Unit,
    onExport: () -> Unit,
    onSaveExport: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            AccountPhase.Loading -> Centered { CircularProgressIndicator() }

            is AccountPhase.Failed -> Centered {
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

            AccountPhase.Loaded -> Column(
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

                state.identity?.let { identity ->
                    Text(identity.displayName, color = klinikColor("textSecondary"))
                }

                state.error?.let {
                    Text(strings.message(it), color = klinikColor("critical"))
                }

                Outcome(state, strings, onSaveExport)

                PasswordSection(state, strings, onChangePassword)
                TwoFactorSection(state, strings, onDisableTwoFactor)
                SessionsSection(state, strings, onEndSession, onSignOutEverywhere)

                Section(strings.dataExport) {
                    Text(strings.dataExportHint, color = klinikColor("textSecondary"))

                    OutlinedButton(
                        onClick = onExport,
                        enabled = !state.busy,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = Tokens.minimumTouchTarget),
                    ) {
                        Text(strings.dataExport)
                    }
                }
            }
        }
    }
}

@Composable
private fun Outcome(
    state: AccountState,
    strings: AccountStrings,
    onSaveExport: (String) -> Unit,
) {
    when (val outcome = state.outcome) {
        null -> Unit

        // Said as an outcome rather than a toast: the session is gone and the
        // next thing this person does is sign in again, which needs
        // explaining.
        AccountOutcome.PasswordChanged -> Text(
            strings.passwordChanged,
            color = klinikColor("success"),
        )

        AccountOutcome.TwoFactorDisabled -> Text(
            strings.twoFactorDisabled,
            color = klinikColor("success"),
        )

        is AccountOutcome.Exported -> Column(
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
        ) {
            Text(strings.exportRows(outcome.export.rowCount), color = klinikColor("textPrimary"))

            // What the file leaves out, named. A portability file with silent
            // gaps is worse than one that says where they are.
            if (outcome.export.notIncluded.isNotEmpty()) {
                Text(
                    strings.exportOmitted,
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("textSecondary"),
                )

                outcome.export.notIncluded.forEach { line ->
                    Text(
                        line,
                        fontSize = Tokens.Typography.caption.size,
                        color = klinikColor("warning"),
                    )
                }
            }

            Button(
                onClick = { onSaveExport(outcome.json) },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(strings.save)
            }
        }
    }
}

@Composable
private fun PasswordSection(
    state: AccountState,
    strings: AccountStrings,
    onChangePassword: (String, String) -> Unit,
) {
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }

    val problems = if (next.isEmpty()) emptyList() else PasswordRules.problems(next)

    Section(strings.changePassword) {
        // Before the fields, not after the button: signing every device out is
        // the kind of thing somebody should know is coming.
        Text(strings.changePasswordHint, color = klinikColor("textSecondary"))

        OutlinedTextField(
            value = current,
            onValueChange = { current = it },
            label = { Text(strings.currentPassword) },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = next,
            onValueChange = { next = it },
            label = { Text(strings.newPassword) },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )

        // While typing, so nobody fills the form in twice to be told by the
        // network.
        problems.forEach { problem ->
            Text(
                strings.rule(problem),
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("warning"),
            )
        }

        Button(
            onClick = {
                onChangePassword(current, next)
                current = ""
                next = ""
            },
            enabled = !state.busy && current.isNotBlank() && problems.isEmpty() && next.isNotEmpty(),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Tokens.minimumTouchTarget),
        ) {
            Text(strings.changePassword)
        }
    }
}

@Composable
private fun TwoFactorSection(
    state: AccountState,
    strings: AccountStrings,
    onDisable: (String) -> Unit,
) {
    var code by remember { mutableStateOf("") }

    Section(strings.twoFactor) {
        Text(strings.twoFactorOn, color = klinikColor("success"))

        if (!state.canDisableTwoFactor) {
            // Said rather than shown as a disabled switch: staff cannot turn
            // it off at all, and a greyed control invites somebody to keep
            // trying.
            Text(strings.twoFactorMandatory, color = klinikColor("textSecondary"))

            return@Section
        }

        Text(strings.disableTwoFactorHint, color = klinikColor("textSecondary"))

        OutlinedTextField(
            value = code,
            onValueChange = { code = it },
            label = { Text(strings.twoFactorCode) },
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedButton(
            onClick = {
                onDisable(code)
                code = ""
            },
            enabled = !state.busy && code.isNotBlank(),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Tokens.minimumTouchTarget),
        ) {
            Text(strings.disableTwoFactor)
        }
    }
}

@Composable
private fun SessionsSection(
    state: AccountState,
    strings: AccountStrings,
    onEndSession: (SessionSummary) -> Unit,
    onSignOutEverywhere: () -> Unit,
) {
    var confirming by remember { mutableStateOf(false) }

    Section(strings.security) {
        state.currentSession?.let { session ->
            Row(modifier = Modifier.fillMaxWidth()) {
                Text(
                    session.deviceName ?: strings.unknownDevice,
                    color = klinikColor("textPrimary"),
                    modifier = Modifier.weight(1f),
                )
                Text(strings.thisDevice, color = klinikColor("textSecondary"))
            }
        }

        Text(strings.otherDevices, color = klinikColor("textSecondary"))

        if (state.otherSessions.isEmpty()) {
            Text(strings.noOtherDevices, color = klinikColor("textSecondary"))
        }

        state.otherSessions.forEach { session ->
            Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    session.deviceName ?: strings.unknownDevice,
                    color = klinikColor("textPrimary"),
                )
                Text(
                    strings.lastSeen(session.lastSeenAt.take(10)),
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("textSecondary"),
                )
                TextButton(
                    onClick = { onEndSession(session) },
                    enabled = !state.busy,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.revoke)
                }
            }
        }

        if (confirming) {
            // Two steps, because it takes this device with it.
            Text(strings.signOutEverywhereConfirm, color = klinikColor("warning"))
        }

        OutlinedButton(
            onClick = { if (confirming) onSignOutEverywhere() else confirming = true },
            enabled = !state.busy,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Tokens.minimumTouchTarget),
        ) {
            Text(strings.signOutEverywhere)
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
