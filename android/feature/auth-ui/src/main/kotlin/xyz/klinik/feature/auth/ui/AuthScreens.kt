package xyz.klinik.feature.auth.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.auth.AuthState
import xyz.klinik.feature.auth.AuthStep

/**
 * The sign-in sequence. Which screen shows is decided by a single step value,
 * so the view never has to reconcile flags that disagree.
 *
 * Text arrives as a resolved string from the caller rather than being looked up
 * here, which keeps this file free of resource lookups and lets the same
 * composables be previewed with fixed text.
 */
@Composable
fun AuthFlowScreen(
    state: AuthState,
    strings: AuthStrings,
    onCredentials: (String, String) -> Unit,
    onCode: (String) -> Unit,
    onConfirmSetup: (String) -> Unit,
    onSignedIn: () -> Unit,
) {
    Surface(color = klinikColor("background")) {
        when (val step = state.step) {
            AuthStep.Credentials -> CredentialsScreen(state, strings, onCredentials)
            AuthStep.TwoFactorCode -> TwoFactorCodeScreen(state, strings, onCode)
            is AuthStep.TwoFactorSetup -> TwoFactorSetupScreen(state, strings, step.secret, onConfirmSetup)
            AuthStep.SignedIn -> onSignedIn()
        }
    }
}

/** Every string the flow needs, resolved once by the caller. */
data class AuthStrings(
    val signIn: String,
    val identifier: String,
    val password: String,
    val twoFactorTitle: String,
    val twoFactorHint: String,
    val twoFactorSetupTitle: String,
    val twoFactorSetupHint: String,
    val done: String,
    val error: String?,
)

@Composable
private fun CredentialsScreen(
    state: AuthState,
    strings: AuthStrings,
    onSubmit: (String, String) -> Unit,
) {
    var identifier by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    FormScaffold(title = strings.signIn) {
        LabelledField(strings.identifier, identifier, { identifier = it }, KeyboardType.Email)
        LabelledField(strings.password, password, { password = it }, KeyboardType.Password, secure = true)

        ErrorBanner(strings.error, state.isLockedOut)

        PrimaryButton(
            title = strings.signIn,
            isBusy = state.isSubmitting,
            // Disabled only for empty input. A locked account still submits, so
            // the user gets the explanation rather than a dead button.
            isEnabled = identifier.isNotBlank() && password.isNotBlank(),
        ) { onSubmit(identifier, password) }
    }
}

@Composable
private fun TwoFactorCodeScreen(state: AuthState, strings: AuthStrings, onSubmit: (String) -> Unit) {
    var code by remember { mutableStateOf("") }

    FormScaffold(title = strings.twoFactorTitle, subtitle = strings.twoFactorHint) {
        LabelledField(strings.twoFactorTitle, code, { code = it }, KeyboardType.NumberPassword)
        ErrorBanner(strings.error, state.isLockedOut)
        PrimaryButton(strings.done, state.isSubmitting, code.length == 6) { onSubmit(code) }
    }
}

@Composable
private fun TwoFactorSetupScreen(
    state: AuthState,
    strings: AuthStrings,
    secret: String,
    onSubmit: (String) -> Unit,
) {
    var code by remember { mutableStateOf("") }

    FormScaffold(title = strings.twoFactorSetupTitle, subtitle = strings.twoFactorSetupHint) {
        // The secret as text as well as a scannable code: scanning fails often
        // enough — a cracked screen, a borrowed phone — that leaving only one
        // route in would strand people at onboarding.
        Surface(
            color = klinikColor("surface"),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                text = secret,
                fontSize = Tokens.Typography.body.size,
                modifier = Modifier.padding(Tokens.Spacing.md),
            )
        }

        LabelledField(strings.twoFactorTitle, code, { code = it }, KeyboardType.NumberPassword)
        ErrorBanner(strings.error, state.isLockedOut)
        PrimaryButton(strings.done, state.isSubmitting, code.length == 6) { onSubmit(code) }
    }
}

@Composable
private fun FormScaffold(
    title: String,
    subtitle: String? = null,
    content: @Composable () -> Unit,
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(Tokens.Spacing.xl),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
            Text(
                text = title,
                fontSize = Tokens.Typography.title.size,
                fontWeight = Tokens.Typography.title.weight,
                color = klinikColor("textPrimary"),
                // One heading per screen, so TalkBack navigation lands
                // somewhere useful.
                modifier = Modifier.semantics { heading() },
            )

            if (subtitle != null) {
                Text(
                    text = subtitle,
                    fontSize = Tokens.Typography.body.size,
                    color = klinikColor("textSecondary"),
                )
            }
        }

        content()
    }
}

/**
 * The label sits above the field rather than inside it: a placeholder-only
 * field loses its label the moment someone types, which is exactly when a
 * returning user wants to check what they are filling in.
 */
@Composable
private fun LabelledField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    keyboardType: KeyboardType,
    secure: Boolean = false,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        Text(
            text = label,
            fontSize = Tokens.Typography.caption.size,
            color = klinikColor("textSecondary"),
        )

        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            visualTransformation = if (secure) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Tokens.minimumTouchTarget),
        )
    }
}

@Composable
private fun PrimaryButton(
    title: String,
    isBusy: Boolean,
    isEnabled: Boolean,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = isEnabled && !isBusy,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = Tokens.minimumTouchTarget),
    ) {
        if (isBusy) {
            CircularProgressIndicator(modifier = Modifier.heightIn(max = Tokens.Spacing.xl))
        } else {
            Text(title, fontSize = Tokens.Typography.subheading.size)
        }
    }
}

/**
 * Carries an icon as well as colour, because a message the reader cannot
 * distinguish by hue is no message at all (spec section 7).
 */
@Composable
private fun ErrorBanner(message: String?, isLockout: Boolean) {
    if (message == null) return

    val state = if (isLockout) Tokens.State.triageUrgent else Tokens.State.labCritical

    Surface(
        color = klinikColor(if (isLockout) "warningSurface" else "criticalSurface"),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
            verticalAlignment = Alignment.Top,
            modifier = Modifier.padding(Tokens.Spacing.md),
        ) {
            // The icon name is shared with iOS; the app module maps it to a
            // drawable. Kept as data here so the token file stays the single
            // source for which state looks like what.
            Text(
                text = state.iconName.take(1).uppercase(),
                color = klinikColor(state.colorName),
                fontSize = Tokens.Typography.body.size,
            )

            Text(
                text = message,
                color = klinikColor("textPrimary"),
                fontSize = Tokens.Typography.body.size,
            )
        }
    }
}
