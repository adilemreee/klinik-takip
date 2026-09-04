package xyz.klinik.feature.consents.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
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
import xyz.klinik.feature.consents.ConsentsPhase
import xyz.klinik.feature.consents.ConsentsState
import xyz.klinik.network.Consent
import xyz.klinik.network.ConsentType

data class ConsentStrings(
    val noticeTitle: String,
    val noticeBody: String,
    val noticeRead: String,
    val noticeAcknowledged: String,
    val consentsTitle: String,
    val optionalNote: String,
    val give: String,
    val withdraw: String,
    val given: String,
    val notGiven: String,
    val withdrawnAt: String,
    val forwardOnly: String,
    val notFound: String,
    val retry: String,
    val typeName: (ConsentType) -> String,
    val explanation: (ConsentType) -> String,
    val message: (String) -> String,
)

/**
 * The patient's permissions (KVKK, spec §8).
 *
 * The layout is Board decision 2026/347 rather than a design preference:
 *
 *   - The **notice** is its own section and takes only an acknowledgement that
 *     it was read. The button says "I have read this", never "I agree" — asking
 *     for agreement to a notice is what the decision forbids.
 *   - The **consents** are separate, one decision each, nothing bundled. A
 *     single "I accept everything" is how a consent stops being freely given.
 *   - Nothing is offered for processing that rests on another ground: treatment
 *     and data processing are not on this screen.
 */
@Composable
fun ConsentsScreen(
    state: ConsentsState,
    strings: ConsentStrings,
    onRetry: () -> Unit,
    onOpenNotice: () -> Unit,
    onChange: (ConsentType, give: Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            ConsentsPhase.Loading -> Centered { CircularProgressIndicator() }

            ConsentsPhase.NotFound -> Centered { Text(strings.notFound) }

            is ConsentsPhase.Failed -> Centered {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(strings.message(phase.messageKey))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            ConsentsPhase.Loaded -> Loaded(state, strings, onOpenNotice, onChange)
        }
    }
}

@Composable
private fun Loaded(
    state: ConsentsState,
    strings: ConsentStrings,
    onOpenNotice: () -> Unit,
    onChange: (ConsentType, Boolean) -> Unit,
) {
    var acknowledged by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Tokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xl),
    ) {
        state.error?.let { Text(strings.message(it), color = klinikColor("critical")) }

        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
            Text(
                strings.noticeTitle,
                color = klinikColor("textPrimary"),
                modifier = Modifier.semantics { heading() },
            )
            Text(strings.noticeBody, color = klinikColor("textSecondary"))

            TextButton(
                onClick = onOpenNotice,
                modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
            ) { Text(strings.noticeTitle) }

            if (acknowledged) {
                Text(strings.noticeAcknowledged, color = klinikColor("success"))
            } else {
                // A button, and its label is "I have read this" — never
                // "I agree". The distinction is the whole point.
                TextButton(
                    onClick = { acknowledged = true },
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) { Text(strings.noticeRead) }
            }
        }

        HorizontalDivider()

        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg)) {
            Text(
                strings.consentsTitle,
                color = klinikColor("textPrimary"),
                modifier = Modifier.semantics { heading() },
            )

            // Said once, at the top: refusing costs nothing, and somebody
            // deciding needs to know that before they read the first one.
            Text(strings.optionalNote, color = klinikColor("textSecondary"))

            for (type in ConsentType.askable) {
                ConsentRow(
                    type = type,
                    active = state.active(type),
                    latest = state.latest(type),
                    isWorking = state.working == type,
                    strings = strings,
                    onChange = onChange,
                )
            }

            Text(strings.forwardOnly, color = klinikColor("textSecondary"))
        }
    }
}

@Composable
private fun ConsentRow(
    type: ConsentType,
    active: Consent?,
    latest: Consent?,
    isWorking: Boolean,
    strings: ConsentStrings,
    onChange: (ConsentType, Boolean) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        Text(strings.typeName(type), color = klinikColor("textPrimary"))

        // What this permission is *not* about, which is the part people get
        // wrong: refusing photo promotion must not read as refusing to have
        // wound photographs taken at all.
        Text(strings.explanation(type), color = klinikColor("textSecondary"))

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (active == null) strings.notGiven else strings.given,
                color = if (active == null) klinikColor("textSecondary") else klinikColor("success"),
                modifier = Modifier.weight(1f),
            )

            if (active == null) {
                Button(
                    onClick = { onChange(type, true) },
                    enabled = !isWorking,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) { Text(strings.give) }
            } else {
                TextButton(
                    onClick = { onChange(type, false) },
                    enabled = !isWorking,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) { Text(strings.withdraw) }
            }
        }

        // The record is kept when a permission is withdrawn, and saying so is
        // the difference between "we forgot" and "we stopped".
        if (active == null && latest?.revokedAt != null) {
            Text("${strings.withdrawnAt}: ${latest.revokedAt}", color = klinikColor("textSecondary"))
        }
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.xl),
        contentAlignment = Alignment.Center,
    ) { content() }
}
