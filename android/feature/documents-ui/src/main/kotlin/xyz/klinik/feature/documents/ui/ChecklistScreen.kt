package xyz.klinik.feature.documents.ui

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
import xyz.klinik.feature.documents.ChecklistPhase
import xyz.klinik.feature.documents.ChecklistState
import xyz.klinik.network.ChecklistItem
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class ChecklistStrings(
    val title: String,
    val explain: String,
    val empty: String,
    val complete: String,
    val retry: String,
    val missing: String,
    val optional: String,
    val received: String,
    val upload: String,
    val missingCount: (Int) -> String,
    val missingOne: String,
    val message: (UiText) -> String,
)

/**
 * What the clinic needs before the operation (spec M17).
 *
 * Everything on one list, arrived and outstanding both. A checklist that
 * showed only the gaps would leave a patient unable to tell "you have sent
 * everything" from "this failed to load" — and telling them the first is the
 * whole reason the screen exists.
 *
 * The count of what is mandatory and missing is at the top, because that is
 * the number that decides whether the operation happens on the day.
 */
@Composable
fun ChecklistScreen(
    state: ChecklistState,
    strings: ChecklistStrings,
    /** Null on the clinician's side, where uploading is the patient's job. */
    onUpload: ((ChecklistItem) -> Unit)? = null,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            ChecklistPhase.Loading -> Centered { CircularProgressIndicator() }

            // No list defined is not an empty list of requirements, and the
            // sentence has to say which.
            ChecklistPhase.Empty -> Centered {
                Text(
                    strings.empty,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            is ChecklistPhase.Failed -> Centered {
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

            ChecklistPhase.Loaded -> Column(
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

                // The number that decides whether the operation happens on the
                // day, before the list rather than after it.
                Surface(
                    color = if (state.complete) {
                        klinikColor("successSurface")
                    } else {
                        klinikColor("warningSurface")
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        when {
                            state.complete -> strings.complete
                            state.missingMandatory == 1 -> strings.missingOne
                            else -> strings.missingCount(state.missingMandatory)
                        },
                        color = if (state.complete) {
                            klinikColor("success")
                        } else {
                            klinikColor("warning")
                        },
                        modifier = Modifier.padding(Tokens.Spacing.lg),
                    )
                }

                if (state.outstanding.isNotEmpty()) {
                    Section(strings.missing) {
                        state.outstanding.forEach { entry ->
                            ItemRow(entry, strings, onUpload)
                        }
                    }
                }

                if (state.done.isNotEmpty()) {
                    Section(strings.received) {
                        state.done.forEach { entry -> ItemRow(entry, strings, onUpload = null) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ItemRow(
    entry: ChecklistItem,
    strings: ChecklistStrings,
    onUpload: ((ChecklistItem) -> Unit)?,
) {
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = Tokens.minimumTouchTarget),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(entry.label, color = klinikColor("textPrimary"))

            // Mandatory or not, in a word: a reader deciding what to do next
            // needs to know which of these is optional.
            if (!entry.mandatory) {
                Text(
                    strings.optional,
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("textSecondary"),
                )
            }
        }

        if (entry.satisfied) {
            Text(strings.received, color = klinikColor("success"))
        } else if (onUpload != null) {
            TextButton(
                onClick = { onUpload(entry) },
                modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(strings.upload)
            }
        } else {
            Text(strings.missing, color = klinikColor("warning"))
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
