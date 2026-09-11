package xyz.klinik.feature.consents.ui

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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
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
import xyz.klinik.feature.consents.PatientConsentsPhase
import xyz.klinik.feature.consents.PatientConsentsState
import xyz.klinik.network.Consent
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class PatientConsentsStrings(
    val title: String,
    val noneRecorded: String,
    val retry: String,
    val inForce: String,
    val withdrawn: String,
    val signedAt: String,
    val version: (Int) -> String,
    val signature: String,
    val notSigned: String,
    val forwardOnly: String,
    val typeName: (Consent) -> String,
    val message: (UiText) -> String,
)

/**
 * What a patient agreed to, read by the clinic (KVKK, spec §8).
 *
 * Read-only. A clinician cannot consent on somebody's behalf, and a switch on
 * this screen would suggest they could.
 *
 * Withdrawn records are kept in their own section rather than removed. A
 * withdrawal is a thing that happened — and because it takes effect forwards
 * only, the processing done before it was lawful and the record of it must not
 * disappear.
 */
@Composable
fun PatientConsentsScreen(
    state: PatientConsentsState,
    strings: PatientConsentsStrings,
    onOpenSignature: (Consent) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            PatientConsentsPhase.Loading -> Centered { CircularProgressIndicator() }

            PatientConsentsPhase.Empty -> Centered {
                Text(
                    strings.noneRecorded,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            is PatientConsentsPhase.Failed -> Centered {
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

            PatientConsentsPhase.Loaded -> Column(
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

                if (state.inForce.isNotEmpty()) {
                    Section(strings.inForce) {
                        state.inForce.forEach { consent ->
                            ConsentRow(consent, strings, onOpenSignature)
                        }
                    }
                }

                if (state.withdrawn.isNotEmpty()) {
                    Section(strings.withdrawn) {
                        // Why the record is still here, said once: withdrawal
                        // takes effect forwards, and the processing done
                        // before it was lawful.
                        Text(
                            strings.forwardOnly,
                            fontSize = Tokens.Typography.caption.size,
                            color = klinikColor("textSecondary"),
                        )

                        state.withdrawn.forEach { consent ->
                            ConsentRow(consent, strings, onOpenSignature)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ConsentRow(
    consent: Consent,
    strings: PatientConsentsStrings,
    onOpenSignature: (Consent) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = Tokens.Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
    ) {
        Text(strings.typeName(consent), color = klinikColor("textPrimary"))

        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                "${strings.signedAt}: ${consent.signedAt.take(10)}",
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
                modifier = Modifier.weight(1f),
            )

            // Which wording was agreed to. Without it, "they consented" names
            // nothing that can be produced afterwards.
            Text(
                strings.version(consent.version),
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
            )
        }

        if (consent.hasSignature) {
            TextButton(
                onClick = { onOpenSignature(consent) },
                modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(strings.signature)
            }
        } else {
            // A consent with a drawn signature and one without are different
            // instruments; only the first can be shown to somebody disputing
            // it, and the screen must not imply proof the clinic lacks.
            Text(
                strings.notSigned,
                fontSize = Tokens.Typography.caption.size,
                color = klinikColor("textSecondary"),
            )
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
