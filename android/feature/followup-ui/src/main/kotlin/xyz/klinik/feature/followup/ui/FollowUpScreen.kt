package xyz.klinik.feature.followup.ui

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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.followup.FollowUpPhase
import xyz.klinik.feature.followup.FollowUpState
import xyz.klinik.network.Milestone
import xyz.klinik.network.MilestoneStatus
import xyz.klinik.network.UiText

data class FollowUpStrings(
    val empty: String,
    val notFound: String,
    val retry: String,
    val nextVisit: String,
    val missedCount: String,
    val markAttended: String,
    val markSkipped: String,
    val milestoneName: (Milestone) -> String,
    val statusName: (MilestoneStatus) -> String,
    val message: (UiText) -> String,
)

/** The check-up calendar generated from the operation date (spec M6). */
@Composable
fun FollowUpScreen(
    state: FollowUpState,
    strings: FollowUpStrings,
    /** Staff mark a visit attended; a patient only reads. */
    canMark: Boolean,
    /**
     * Now, as ISO-8601, supplied by the caller.
     *
     * A screen that reads the clock itself cannot be tested at the one boundary
     * that matters here — which visit counts as next.
     */
    nowIso: String,
    onRetry: () -> Unit,
    onMark: (milestoneId: String, status: MilestoneStatus) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            FollowUpPhase.Loading -> Centered { CircularProgressIndicator() }

            FollowUpPhase.None -> Centered { Text(strings.empty) }

            FollowUpPhase.NotFound -> Centered { Text(strings.notFound) }

            is FollowUpPhase.Failed -> Centered {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(strings.message(UiText.Key(phase.messageKey)))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            FollowUpPhase.Loaded -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Tokens.Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
            ) {
                // The next visit, first and large. It is what a patient opens
                // this screen to find, and a list they have to read to the
                // middle of is one they read wrong.
                state.next(nowIso)?.let { next ->
                    Surface(color = klinikColor("infoSurface"), modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(Tokens.Spacing.lg),
                            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
                        ) {
                            Text(strings.nextVisit, color = klinikColor("textSecondary"))
                            Text(
                                strings.milestoneName(next),
                                color = klinikColor("textPrimary"),
                                modifier = Modifier.semantics { heading() },
                            )
                            Text(next.dueAt, color = klinikColor("textPrimary"))
                        }
                    }
                }

                if (state.missed.isNotEmpty()) {
                    Text(
                        "${strings.missedCount}: ${state.missed.size}",
                        color = klinikColor("warning"),
                    )
                }

                state.error?.let { Text(strings.message(it), color = klinikColor("critical")) }

                for (milestone in state.schedule?.milestones.orEmpty()) {
                    MilestoneRow(milestone, strings, canMark, state.working == milestone.id, onMark)
                }
            }
        }
    }
}

@Composable
private fun MilestoneRow(
    milestone: Milestone,
    strings: FollowUpStrings,
    canMark: Boolean,
    isWorking: Boolean,
    onMark: (String, MilestoneStatus) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(
                strings.milestoneName(milestone),
                color = klinikColor("textPrimary"),
                modifier = Modifier.weight(1f),
            )

            // State in words as well as colour, because a colour a reader
            // cannot distinguish says nothing (spec section 7).
            Text(strings.statusName(milestone.status), color = tintFor(milestone.status))
        }

        Text(milestone.dueAt, color = klinikColor("textSecondary"))

        if (canMark && milestone.status.isOutstanding) {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.md)) {
                TextButton(
                    onClick = { onMark(milestone.id, MilestoneStatus.COMPLETED) },
                    enabled = !isWorking,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) { Text(strings.markAttended) }

                TextButton(
                    onClick = { onMark(milestone.id, MilestoneStatus.SKIPPED) },
                    enabled = !isWorking,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) { Text(strings.markSkipped) }
            }
        }
    }
}

@Composable
private fun tintFor(status: MilestoneStatus) = when (status) {
    MilestoneStatus.COMPLETED -> klinikColor("success")
    MilestoneStatus.MISSED -> klinikColor("warning")
    MilestoneStatus.SKIPPED -> klinikColor("textSecondary")
    MilestoneStatus.PENDING, MilestoneStatus.NOTIFIED -> klinikColor("info")
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.xl),
        contentAlignment = Alignment.Center,
    ) { content() }
}
