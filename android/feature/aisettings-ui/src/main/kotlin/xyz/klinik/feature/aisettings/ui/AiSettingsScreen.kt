package xyz.klinik.feature.aisettings.ui

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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.aisettings.AiSettingsDraft
import xyz.klinik.feature.aisettings.AiSettingsPhase
import xyz.klinik.feature.aisettings.AiSettingsState
import xyz.klinik.network.AiProviderChoice
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class AiSettingsStrings(
    val title: String,
    val notPermitted: String,
    val retry: String,
    val provider: String,
    val model: String,
    val apiKey: String,
    val apiKeyWriteOnly: String,
    /** "Kayıtlı anahtar: •••• {last4}", with the four already in it. */
    val apiKeyStored: (String) -> String,
    val inputPrice: String,
    val outputPrice: String,
    val priceHint: String,
    val pricingPage: String,
    val budget: String,
    val retention: String,
    val zeroRetention: String,
    val zeroRetentionCleared: String,
    val retentionNote: String,
    val ready: String,
    val notReady: String,
    val notClinicalReady: String,
    val save: String,
    val test: String,
    /** "Bağlantı çalışıyor ({model})", with the version that answered in it. */
    val testOk: (String) -> String,
    val testFailed: String,
    val clear: String,
    val missingName: (String) -> String,
    val message: (UiText) -> String,
)

/**
 * Which model service the clinic uses, and on what terms (spec 3.4, 14.5).
 *
 * The key field is write-only and says so, because nothing can read it back —
 * what the screen shows instead is the last four characters, which answers the
 * only question anybody has about it.
 *
 * "Ready" and "ready for clinical work" are two different lines, deliberately.
 * Without the zero-retention declaration the layer still refuses every
 * clinical prompt, and a screen showing only `ready` would tell an
 * administrator they had finished while the interesting half was off.
 */
@Composable
fun AiSettingsScreen(
    state: AiSettingsState,
    strings: AiSettingsStrings,
    onChooseProvider: (AiProviderChoice) -> Unit,
    onEdit: (AiSettingsDraft.() -> AiSettingsDraft) -> Unit,
    onSave: () -> Unit,
    onTest: () -> Unit,
    onClear: () -> Unit,
    onOpenPricing: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            AiSettingsPhase.Loading -> Centered { CircularProgressIndicator() }

            AiSettingsPhase.NotPermitted -> Centered {
                Text(
                    strings.notPermitted,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            is AiSettingsPhase.Failed -> Centered {
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

            AiSettingsPhase.Loaded -> Column(
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

                Readiness(state, strings)

                state.error?.let {
                    Text(strings.message(it), color = klinikColor("critical"))
                }

                Section(strings.provider) {
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
                    ) {
                        state.providers.forEach { provider ->
                            FilterChip(
                                selected = provider.id == state.draft.provider,
                                onClick = { onChooseProvider(provider.id) },
                                label = { Text(provider.label) },
                                modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                            )
                        }
                    }

                    OutlinedTextField(
                        value = state.draft.model,
                        onValueChange = { value -> onEdit { copy(model = value) } },
                        label = { Text(strings.model) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                Section(strings.apiKey) {
                    state.settings?.apiKeyLast4?.let { last4 ->
                        Text(strings.apiKeyStored(last4), color = klinikColor("textSecondary"))
                    }

                    OutlinedTextField(
                        value = state.draft.apiKey,
                        onValueChange = { value -> onEdit { copy(apiKey = value) } },
                        label = { Text(strings.apiKey) },
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    // Said before it is typed, not after it disappears.
                    Text(
                        strings.apiKeyWriteOnly,
                        fontSize = Tokens.Typography.caption.size,
                        color = klinikColor("textSecondary"),
                    )
                }

                Section(strings.priceHint) {
                    Price(strings.inputPrice, state.draft.inputPrice) { value ->
                        onEdit { copy(inputPrice = value) }
                    }
                    Price(strings.outputPrice, state.draft.outputPrice) { value ->
                        onEdit { copy(outputPrice = value) }
                    }
                    Price(strings.budget, state.draft.budget) { value ->
                        onEdit { copy(budget = value) }
                    }

                    state.chosenProvider?.let { provider ->
                        TextButton(
                            onClick = { onOpenPricing(provider.pricingUrl) },
                            modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                        ) {
                            Text(strings.pricingPage)
                        }
                    }
                }

                Section(strings.retention) {
                    // The provider's own terms, beside the box rather than
                    // behind a link: a tick against an unread sentence is not a
                    // record of anything.
                    state.chosenProvider?.let { provider ->
                        Text(provider.retentionNote, color = klinikColor("textSecondary"))
                    }

                    if (state.retentionNeedsConfirming) {
                        Text(strings.zeroRetentionCleared, color = klinikColor("warning"))
                    }

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = Tokens.minimumTouchTarget),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(
                            checked = state.draft.zeroRetentionConfirmed,
                            onCheckedChange = { on ->
                                onEdit { copy(zeroRetentionConfirmed = on) }
                            },
                        )
                        Text(strings.zeroRetention, color = klinikColor("textPrimary"))
                    }

                    state.settings?.zeroRetentionAt?.let { at ->
                        Text(
                            "${strings.retentionNote}: ${at.take(10)}",
                            fontSize = Tokens.Typography.caption.size,
                            color = klinikColor("textSecondary"),
                        )
                    }
                }

                state.testResult?.let { result ->
                    Text(
                        if (result.ok) {
                            strings.testOk(result.model.orEmpty())
                        } else {
                            "${strings.testFailed}${result.error?.let { ": $it" }.orEmpty()}"
                        },
                        color = if (result.ok) klinikColor("success") else klinikColor("critical"),
                    )
                }

                Button(
                    onClick = onSave,
                    enabled = state.canSave,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.save)
                }

                OutlinedButton(
                    onClick = onTest,
                    enabled = !state.busy && state.settings?.hasApiKey == true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.test)
                }

                TextButton(
                    onClick = onClear,
                    enabled = !state.busy,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.clear)
                }
            }
        }
    }
}

/**
 * Running, and running for clinical work, are two statements.
 *
 * Without the declaration the layer refuses every clinical prompt, so a screen
 * that said only "ready" would tell an administrator they had finished while
 * the half the clinic cares about was still off.
 */
@Composable
private fun Readiness(state: AiSettingsState, strings: AiSettingsStrings) {
    val settings = state.settings ?: return

    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        Text(
            if (settings.ready) strings.ready else strings.notReady,
            color = if (settings.ready) klinikColor("success") else klinikColor("textSecondary"),
        )

        if (settings.ready && !settings.readyForClinicalUse) {
            Text(strings.notClinicalReady, color = klinikColor("warning"))
        }

        settings.missingStringKeys.forEach { key ->
            Text(
                strings.missingName(key),
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("warning"),
            )
        }
    }
}

@Composable
private fun Price(label: String, value: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = Modifier.fillMaxWidth(),
    )
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
