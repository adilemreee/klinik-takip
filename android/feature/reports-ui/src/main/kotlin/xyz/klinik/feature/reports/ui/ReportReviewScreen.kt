package xyz.klinik.feature.reports.ui

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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import xyz.klinik.design.MarkdownText
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.reports.ReportReviewPhase
import xyz.klinik.feature.reports.ReportReviewState
import xyz.klinik.network.ReportView
import xyz.klinik.network.RiskLevel
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class ReportReviewStrings(
    val title: String,
    val empty: String,
    val retry: String,
    val doctorView: String,
    val patientView: String,
    val noPatientText: String,
    val releaseAction: String,
    val holdAction: String,
    val generatedAt: String,
    val riskName: (RiskLevel) -> String,
    val message: (UiText) -> String,
)

/**
 * The sign-off queue (spec M5).
 *
 * Both halves of the report are on the row, labelled, because the decision is
 * about the second one: a clinician approves the clinical reading and decides
 * in the same action whether the plain-language half goes to the patient.
 * Hiding the patient's version behind a tap would mean releasing text nobody
 * read.
 *
 * Worst risk first — a critical interpretation from an hour ago outranks a
 * low-risk one from yesterday.
 */
@Composable
fun ReportReviewScreen(
    state: ReportReviewState,
    strings: ReportReviewStrings,
    onRetry: () -> Unit,
    onReview: (reportId: String, release: Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            ReportReviewPhase.Loading -> Centered { CircularProgressIndicator() }

            // A finished queue, not a list that failed to load.
            ReportReviewPhase.Empty -> Centered {
                Text(strings.empty, color = klinikColor("textSecondary"))
            }

            is ReportReviewPhase.Failed -> Centered {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(strings.message(UiText.Key(phase.messageKey)))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            ReportReviewPhase.Loaded -> Column(
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

                state.actionErrorKey?.let { key ->
                    Text(strings.message(UiText.Key(key)), color = klinikColor("critical"))
                }

                state.ordered.forEach { view ->
                    ReportCard(
                        view = view,
                        strings = strings,
                        busy = state.busyId == view.report.id,
                        onReview = onReview,
                    )
                }
            }
        }
    }
}

@Composable
private fun ReportCard(
    view: ReportView,
    strings: ReportReviewStrings,
    busy: Boolean,
    onReview: (reportId: String, release: Boolean) -> Unit,
) {
    val report = view.report
    val risk = report.riskLevel

    Surface(
        // A report the clinic should read first looks like one before it is
        // read, rather than only saying so in a label halfway down.
        color = if (risk?.needsAttention == true) {
            klinikColor("criticalSurface")
        } else {
            klinikColor("surface")
        },
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.md),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "${strings.generatedAt}: ${report.generatedAt.take(10)}",
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("textSecondary"),
                )

                risk?.let {
                    Text(
                        strings.riskName(it),
                        fontSize = Tokens.Typography.caption.size,
                        fontWeight = Tokens.Typography.subheading.weight,
                        color = if (it.needsAttention) {
                            klinikColor("critical")
                        } else {
                            klinikColor("textSecondary")
                        },
                    )
                }
            }

            Text(
                strings.doctorView,
                fontSize = Tokens.Typography.subheading.size,
                fontWeight = Tokens.Typography.subheading.weight,
                color = klinikColor("textPrimary"),
                modifier = Modifier.semantics { heading() },
            )
            MarkdownText(report.contentMd)

            Text(
                strings.patientView,
                fontSize = Tokens.Typography.subheading.size,
                fontWeight = Tokens.Typography.subheading.weight,
                color = klinikColor("textPrimary"),
                modifier = Modifier.semantics { heading() },
            )

            val patientText = report.patientFacingMd

            if (patientText.isNullOrBlank()) {
                // Approving this one sends the patient nothing, and a doctor
                // pressing "send to the patient" should know that first.
                Text(strings.noPatientText, color = klinikColor("warning"))
            } else {
                MarkdownText(patientText)
            }

            // The warning that goes under every AI output (spec M5).
            Text(
                view.disclaimer,
                fontSize = Tokens.Typography.footnote.size,
                color = klinikColor("textSecondary"),
            )

            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
                Button(
                    onClick = { onReview(report.id, true) },
                    enabled = !busy && !patientText.isNullOrBlank(),
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.releaseAction)
                }

                OutlinedButton(
                    onClick = { onReview(report.id, false) },
                    enabled = !busy,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.holdAction)
                }
            }
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
