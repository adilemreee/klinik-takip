package xyz.klinik.feature.consents.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import xyz.klinik.design.MarkdownText
import xyz.klinik.design.SignaturePad
import xyz.klinik.design.SignaturePadLabels
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.design.signaturePng
import xyz.klinik.feature.consents.ConsentFormPhase
import xyz.klinik.feature.consents.ConsentFormState
import xyz.klinik.network.UiText
import xyz.klinik.shell.Signature
import xyz.klinik.shell.SignaturePoint

/** Text the screen needs, resolved by the caller from string resources. */
data class ConsentFormStrings(
    val title: String,
    val unpublished: String,
    val unpublishedWhy: String,
    val retry: String,
    val readToEndFirst: String,
    val signHint: String,
    val clearSignature: String,
    val signed: String,
    val notSigned: String,
    val signatureRequired: String,
    val action: String,
    val thanks: String,
    val version: (Int) -> String,
    val message: (UiText) -> String,
)

/**
 * Reading and signing the treatment consent (spec §8).
 *
 * The button does nothing until the text has been scrolled to the end and a
 * mark has been drawn, and the screen says which of the two is missing rather
 * than leaving somebody pressing a dead button. Neither gate is a formality: a
 * consent nobody read is not informed, and a consent record with a blank where
 * the signature belongs is one the clinic cannot stand behind.
 *
 * The text is the server's, rendered as it was written. The version is on
 * screen because "they consented" names nothing without saying to what.
 */
@Composable
fun ConsentFormScreen(
    state: ConsentFormState,
    strings: ConsentFormStrings,
    onReadToEnd: () -> Unit,
    onSignedChange: (Boolean) -> Unit,
    onSubmit: (signaturePng: String?) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strokes = remember { mutableStateListOf<List<SignaturePoint>>() }

    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            ConsentFormPhase.Loading -> Centred { CircularProgressIndicator() }

            // A form that names no procedure is not a valid informed consent,
            // so the clinic has not published one — which is a different thing
            // from this screen failing, and says what has to happen next.
            ConsentFormPhase.Unpublished -> Centred {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        strings.unpublished,
                        color = klinikColor("textPrimary"),
                        textAlign = TextAlign.Center,
                    )
                    Text(
                        strings.unpublishedWhy,
                        fontSize = Tokens.Typography.caption.size,
                        color = klinikColor("textSecondary"),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = Tokens.Spacing.sm),
                    )
                }
            }

            ConsentFormPhase.Signed -> Centred {
                Text(
                    strings.thanks,
                    color = klinikColor("success"),
                    textAlign = TextAlign.Center,
                )
            }

            is ConsentFormPhase.Failed -> Centred {
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

            ConsentFormPhase.Loaded -> {
                val scroll = rememberScrollState()

                // Reaching the bottom is what "read" means here, and it is
                // recorded the moment it happens rather than being inferred
                // when the button is pressed.
                LaunchedEffect(scroll) {
                    snapshotFlow { scroll.value >= scroll.maxValue - 1 }
                        .collect { atEnd -> if (atEnd) onReadToEnd() }
                }

                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(scroll)
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

                    state.form?.let { form ->
                        // Which wording. "They consented" names nothing
                        // without it.
                        Text(
                            strings.version(form.version),
                            fontSize = Tokens.Typography.caption.size,
                            color = klinikColor("textSecondary"),
                        )

                        MarkdownText(form.body)
                    }

                    state.error?.let {
                        Text(strings.message(it), color = klinikColor("critical"))
                    }

                    SignaturePad(
                        strokes = strokes,
                        labels = SignaturePadLabels(
                            hint = strings.signHint,
                            clear = strings.clearSignature,
                            signed = strings.signed,
                            notSigned = strings.notSigned,
                        ),
                        onStrokes = { updated ->
                            strokes.clear()
                            strokes.addAll(updated)
                            onSignedChange(Signature.isSigned(updated))
                        },
                    )

                    // Which gate is closed, rather than a dead button.
                    if (!state.readToEnd) {
                        Text(strings.readToEndFirst, color = klinikColor("warning"))
                    } else if (!state.signed) {
                        Text(strings.signatureRequired, color = klinikColor("warning"))
                    }

                    Button(
                        onClick = {
                            onSubmit(signaturePng(strokes.toList(), PAD_WIDTH, PAD_HEIGHT))
                        },
                        enabled = state.canSubmit,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = Tokens.minimumTouchTarget),
                    ) {
                        Text(strings.action)
                    }
                }
            }
        }
    }
}

/**
 * The size the signature is rendered at.
 *
 * Fixed rather than the pad's measured width: the stored image is laid over a
 * printed document, and a mark whose dimensions depend on the phone it was
 * drawn on would come out a different size on every consent.
 */
private const val PAD_WIDTH = 1000
private const val PAD_HEIGHT = 360

@Composable
private fun Centred(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.xl),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { content() }
    }
}
