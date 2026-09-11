package xyz.klinik.feature.briefing.ui

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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.briefing.BriefingPhase
import xyz.klinik.feature.briefing.BriefingState
import xyz.klinik.network.RiskItem
import xyz.klinik.network.RiskKind
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class BriefingStrings(
    val title: String,
    val quiet: String,
    val retry: String,
    val atRisk: String,
    val yesterday: String,
    val today: String,
    val newMessages: String,
    val urgentMessages: String,
    val emergencies: String,
    val complications: String,
    val criticalLabs: String,
    val appointments: String,
    val followUps: String,
    val aiSummary: String,
    val aiDisclaimer: String,
    val riskName: (RiskKind) -> String,
    val waitingMinutes: (Int) -> String,
    val waitingHours: (Int) -> String,
    val message: (UiText) -> String,
)

/**
 * The clinician's morning (spec M5).
 *
 * Who needs attention comes first and the counts come after, because the list
 * is read from the top and abandoned when the phone rings. The AI paragraph is
 * last and labelled: it is a reading of the numbers above it, and a screen
 * that led with it would make a switched-off AI layer look like an empty
 * morning.
 */
@Composable
fun BriefingScreen(
    state: BriefingState,
    strings: BriefingStrings,
    onRetry: () -> Unit,
    /**
     * The name travels with the id.
     *
     * The file's title bar is drawn before its first response arrives, and the
     * briefing already knows whose row was tapped; passing only the id would
     * leave a clinician looking at an unnamed record for as long as the network
     * takes.
     */
    onOpenPatient: (id: String, name: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            BriefingPhase.Loading -> Centered { CircularProgressIndicator() }

            // Not an empty screen: a clinician who reads "nothing waiting" has
            // been told something.
            BriefingPhase.Quiet -> Centered {
                Text(strings.quiet, color = klinikColor("textSecondary"))
            }

            is BriefingPhase.Failed -> Centered {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(strings.message(UiText.Key(phase.messageKey)))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            BriefingPhase.Loaded -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Tokens.Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
            ) {
                if (state.atRisk.isNotEmpty()) {
                    Text(
                        strings.atRisk,
                        fontSize = Tokens.Typography.subheading.size,
                        fontWeight = Tokens.Typography.subheading.weight,
                        color = klinikColor("textPrimary"),
                        modifier = Modifier.semantics { heading() },
                    )

                    for (item in state.atRisk) {
                        RiskRow(item, strings, onOpenPatient)
                    }
                }

                state.briefing?.facts?.let { facts ->
                    Counts(
                        title = strings.yesterday,
                        counts = listOf(
                            strings.newMessages to facts.yesterday.newMessages,
                            strings.urgentMessages to facts.yesterday.urgentMessages,
                            strings.emergencies to facts.yesterday.emergencies,
                            strings.complications to facts.yesterday.complications,
                            strings.criticalLabs to facts.yesterday.criticalLabs,
                        ),
                    )

                    Counts(
                        title = strings.today,
                        counts = listOf(
                            strings.appointments to facts.today.appointments,
                            strings.followUps to facts.today.followUps,
                        ),
                    )
                }

                // Last, and named as what it is. The numbers above are the
                // briefing; this is somebody's reading of them.
                state.narrative?.let { narrative ->
                    Surface(
                        color = klinikColor("surface"),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(
                            modifier = Modifier.padding(Tokens.Spacing.lg),
                            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
                        ) {
                            Text(
                                strings.aiSummary,
                                fontSize = Tokens.Typography.caption.size,
                                color = klinikColor("textSecondary"),
                            )
                            Text(narrative, color = klinikColor("textPrimary"))
                            Text(
                                strings.aiDisclaimer,
                                fontSize = Tokens.Typography.caption.size,
                                color = klinikColor("textSecondary"),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RiskRow(
    item: RiskItem,
    strings: BriefingStrings,
    onOpenPatient: (id: String, name: String) -> Unit,
) {
    // How long, in the unit that reads right: "3 saat" rather than "187 dk".
    val waited = if (item.showsHours) {
        strings.waitingHours(item.waitingHours)
    } else {
        strings.waitingMinutes(item.waitingMinutes)
    }

    Surface(
        color = if (item.kind == RiskKind.EMERGENCY_UNANSWERED) {
            klinikColor("criticalSurface")
        } else {
            klinikColor("surface")
        },
        modifier = Modifier.fillMaxWidth(),
    ) {
        TextButton(
            onClick = { onOpenPatient(item.patientId, item.patientName) },
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Tokens.minimumTouchTarget),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(Tokens.Spacing.sm),
                verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
            ) {
                Text(item.patientName, color = klinikColor("textPrimary"))
                Text(
                    "${strings.riskName(item.kind)} · $waited",
                    fontSize = Tokens.Typography.caption.size,
                    color = if (item.kind == RiskKind.EMERGENCY_UNANSWERED) {
                        klinikColor("critical")
                    } else {
                        klinikColor("textSecondary")
                    },
                )
                Text(
                    item.detail,
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("textSecondary"),
                )
            }
        }
    }
}

/** A row of counts. Zeroes are left out: a column of noughts is noise. */
@Composable
private fun Counts(title: String, counts: List<Pair<String, Int>>) {
    val shown = counts.filter { it.second > 0 }

    if (shown.isEmpty()) return

    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
        Text(
            title,
            fontSize = Tokens.Typography.subheading.size,
            fontWeight = Tokens.Typography.subheading.weight,
            color = klinikColor("textPrimary"),
            modifier = Modifier.semantics { heading() },
        )

        for ((label, count) in shown) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics(mergeDescendants = true) {
                        contentDescription = "$label: $count"
                    },
            ) {
                Text("$count", color = klinikColor("textPrimary"))
                Text(label, color = klinikColor("textSecondary"))
            }
        }
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxSize()
            .padding(Tokens.Spacing.xl),
    ) {
        content()
    }
}
