package xyz.klinik.feature.briefing.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import xyz.klinik.design.AdaptiveStack
import xyz.klinik.design.Badge
import xyz.klinik.design.FlowRow
import xyz.klinik.design.InitialsAvatar
import xyz.klinik.design.KlinikCard
import xyz.klinik.design.NavigationRow
import xyz.klinik.design.SectionHeader
import xyz.klinik.design.StatTile
import xyz.klinik.design.Tokens
import xyz.klinik.design.Tone
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.briefing.BriefingPhase
import xyz.klinik.feature.briefing.BriefingState
import xyz.klinik.feature.briefing.StaffTool
import xyz.klinik.network.CalendarEntry
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
    /** The greeting for this hour, and the date under it. */
    val greeting: String,
    val date: String,
    val riskCount: (Int) -> String,
    val emergencyOpen: (Int) -> String,
    val openQueue: String,
    val unanswered: String,
    val todayCount: (Int, Int) -> String,
    val nothingToday: String,
    val noAppointmentsToday: String,
    val next: String,
    val shortcuts: String,
    val pendingReports: String,
    val pendingReportsHint: String,
    val flaggedPhotos: String,
    val flaggedPhotosHint: String,
    val toolName: (StaffTool) -> String,
    val appointmentType: (CalendarEntry) -> String,
    val appointmentStatus: (CalendarEntry) -> String,
    val timeOfDay: (String) -> String,
    val isUpcoming: (CalendarEntry) -> Boolean,
    val riskName: (RiskKind) -> String,
    val waitingMinutes: (Int) -> String,
    val waitingHours: (Int) -> String,
    val message: (UiText) -> String,
)

/**
 * The clinician's morning (spec M5).
 *
 * Ordered the way a clinician triages rather than the way the data arrives: an
 * unanswered emergency is at the top, the people already waiting come next,
 * then the day as the clock will run it, and yesterday's counts are near the
 * bottom because they are context rather than a task.
 *
 * It ends with the clinic's other screens by name. A morning with nothing
 * wrong in it is the common case, and a screen that has nothing to say on
 * those mornings is a screen a clinician stops opening — which is what this
 * one did: a quiet morning drew one sentence on an otherwise blank page.
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
    onOpenEmergencies: () -> Unit,
    onOpenPendingReports: () -> Unit,
    onOpenFlaggedPhotos: () -> Unit,
    onOpenTool: (StaffTool) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xl),
        ) {
            Hero(state, strings)

            when (val phase = state.phase) {
                BriefingPhase.Loading -> Centered { CircularProgressIndicator() }

                is BriefingPhase.Failed -> Centered {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(strings.message(UiText.Key(phase.messageKey)))
                        TextButton(
                            onClick = onRetry,
                            modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                        ) {
                            Text(strings.retry)
                        }
                    }
                }

                BriefingPhase.Loaded -> {
                    if (state.emergencies.isNotEmpty()) {
                        EmergencyBanner(state, strings, onOpenEmergencies)
                    }

                    if (state.atRisk.isNotEmpty()) {
                        SectionHeader(strings.atRisk)

                        for (item in state.atRisk) {
                            RiskRow(item, strings, onOpenPatient)
                        }
                    }

                    Today(state, strings, onOpenPatient)
                    Queues(state, strings, onOpenPendingReports, onOpenFlaggedPhotos)

                    state.narrative?.let { narrative -> Narrative(narrative, strings) }

                    state.briefing?.facts?.let { facts -> Yesterday(facts.yesterday, strings) }

                    Shortcuts(strings, onOpenTool)
                }
            }
        }
    }
}

/**
 * The greeting, the date, and the morning in one sentence.
 *
 * The sentence is the point. Everything under it is detail, and a clinician
 * who reads nothing else should still know from the top of the screen whether
 * anybody is waiting on them.
 */
@Composable
private fun Hero(state: BriefingState, strings: BriefingStrings) {
    val status: Triple<String, Tone, Boolean>? = when {
        state.phase !is BriefingPhase.Loaded -> null
        state.emergencies.isNotEmpty() ->
            Triple(strings.emergencyOpen(state.emergencies.size), Tone.Critical, true)
        state.atRisk.isNotEmpty() -> Triple(strings.riskCount(state.atRisk.size), Tone.Warning, true)
        else -> Triple(strings.quiet, Tone.Success, true)
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(klinikColor("infoSurface"), RoundedCornerShape(Tokens.Radius.lg))
            .padding(Tokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.md),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs)) {
            Text(
                strings.greeting,
                color = klinikColor("textPrimary"),
                fontSize = Tokens.Typography.title.size,
                lineHeight = Tokens.Typography.title.lineHeight,
                fontWeight = Tokens.Typography.title.weight,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                strings.date,
                color = klinikColor("textSecondary"),
                fontSize = Tokens.Typography.caption.size,
            )
        }

        status?.let { (text, tone, _) ->
            Text(
                text,
                color = klinikColor("textPrimary"),
                fontSize = Tokens.Typography.callout.size,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(klinikColor(tone.surface), RoundedCornerShape(Tokens.Radius.md))
                    .padding(horizontal = Tokens.Spacing.md, vertical = Tokens.Spacing.sm),
            )
        }
    }
}

/** The one thing on this screen that is allowed to shout. */
@Composable
private fun EmergencyBanner(
    state: BriefingState,
    strings: BriefingStrings,
    onOpenEmergencies: () -> Unit,
) {
    KlinikCard(tone = Tone.Critical) {
        Text(
            strings.emergencyOpen(state.emergencies.size),
            color = klinikColor("critical"),
            fontSize = Tokens.Typography.heading.size,
            fontWeight = Tokens.Typography.heading.weight,
        )

        for (call in state.emergencies.take(3)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics(mergeDescendants = true) {
                        contentDescription = "${call.summary.fullName}, ${waitingText(call.waitingMinutes, strings)}"
                    },
                horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
            ) {
                Text(
                    call.summary.fullName,
                    color = klinikColor("textPrimary"),
                    modifier = Modifier.weight(1f),
                )

                if (call.unanswered) {
                    Badge(strings.unanswered, tone = Tone.Critical)
                }

                Text(
                    waitingText(call.waitingMinutes, strings),
                    color = klinikColor("textSecondary"),
                    fontSize = Tokens.Typography.caption.size,
                )
            }
        }

        TextButton(
            onClick = onOpenEmergencies,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Tokens.minimumTouchTarget),
        ) {
            Text(strings.openQueue, color = klinikColor("critical"))
        }
    }
}

/**
 * The day as the clock will run it.
 *
 * The briefing counts appointments; it does not say whose or when, and a
 * doctor reading "5" has been told the size of their day and nothing they can
 * act on. Absent rather than empty when the calendar could not be read: "no
 * appointments today" is a claim, and an account that may not read the
 * calendar has no business making it.
 */
@Composable
private fun Today(
    state: BriefingState,
    strings: BriefingStrings,
    onOpenPatient: (id: String, name: String) -> Unit,
) {
    val facts = state.briefing?.facts ?: return
    val isLarge = LocalDensity.current.fontScale >= 1.6f

    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.md)) {
        SectionHeader(
            strings.today,
            subtitle = strings.todayCount(facts.today.appointments, facts.today.followUps),
        )

        // Both counts, always — a zero is an answer, and a tile that
        // disappears when nothing is booked reads as a tile somebody removed.
        // Colour is what a count earns by not being zero.
        AdaptiveStack(stacked = isLarge) {
            StatTile(
                value = "${facts.today.appointments}",
                label = strings.appointments,
                tone = if (facts.today.appointments > 0) Tone.Info else Tone.Neutral,
                modifier = Modifier.weight(1f),
            )
            StatTile(
                value = "${facts.today.followUps}",
                label = strings.followUps,
                tone = if (facts.today.followUps > 0) Tone.Success else Tone.Neutral,
                modifier = Modifier.weight(1f),
            )
        }

        val schedule = state.schedule ?: return@Column

        if (schedule.isEmpty()) {
            // Only when the day has something else in it. On a morning where
            // every number is zero the two tiles above have already said so.
            if (facts.today.appointments > 0 || facts.today.followUps > 0) {
                KlinikCard {
                    Text(
                        if (facts.today.followUps > 0) {
                            strings.noAppointmentsToday
                        } else {
                            strings.nothingToday
                        },
                        color = klinikColor("textSecondary"),
                    )
                }
            }
        } else {
            val next = schedule.firstOrNull { strings.isUpcoming(it) }

            KlinikCard {
                schedule.forEachIndexed { index, entry ->
                    if (index > 0) HorizontalDivider(color = klinikColor("border"))

                    ScheduleRow(
                        entry = entry,
                        strings = strings,
                        isNext = entry === next,
                        onOpen = { onOpenPatient(entry.patient.id, entry.patient.fullName) },
                    )
                }
            }
        }
    }
}

@Composable
private fun ScheduleRow(
    entry: CalendarEntry,
    strings: BriefingStrings,
    isNext: Boolean,
    onOpen: () -> Unit,
) {
    val done = !strings.isUpcoming(entry)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .heightIn(min = Tokens.minimumTouchTarget)
            .padding(vertical = Tokens.Spacing.sm)
            .semantics(mergeDescendants = true) {
                contentDescription = "${strings.timeOfDay(entry.appointment.scheduledAt)}, " +
                    "${entry.patient.fullName}, ${strings.appointmentType(entry)}"
            },
        horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            strings.timeOfDay(entry.appointment.scheduledAt),
            color = klinikColor(if (done) "textSecondary" else "textPrimary"),
            fontSize = Tokens.Typography.subheading.size,
            fontWeight = Tokens.Typography.subheading.weight,
        )

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
        ) {
            Text(
                entry.patient.fullName,
                color = klinikColor(if (done) "textSecondary" else "textPrimary"),
            )

            FlowRow {
                Badge(strings.appointmentType(entry))

                if (isNext) Badge(strings.next, tone = Tone.Info)
                if (done) Badge(strings.appointmentStatus(entry))
            }
        }
    }
}

/**
 * Work queues this account is allowed to see.
 *
 * A row appears when the count is readable at all, not when it is greater than
 * zero: a nurse who may not review reports should not be shown a review queue,
 * but a doctor whose queue is empty should still be able to see that it is.
 */
@Composable
private fun Queues(
    state: BriefingState,
    strings: BriefingStrings,
    onOpenPendingReports: () -> Unit,
    onOpenFlaggedPhotos: () -> Unit,
) {
    if (state.pendingReportCount == null && state.flaggedPhotoCount == null) return

    KlinikCard {
        state.pendingReportCount?.let { pending ->
            NavigationRow(
                title = strings.pendingReports,
                detail = strings.pendingReportsHint,
                badge = pending.takeIf { it > 0 }?.toString(),
                badgeTone = Tone.Warning,
                onClick = onOpenPendingReports,
            )
        }

        state.flaggedPhotoCount?.let { flagged ->
            if (state.pendingReportCount != null) HorizontalDivider(color = klinikColor("border"))

            NavigationRow(
                title = strings.flaggedPhotos,
                detail = strings.flaggedPhotosHint,
                badge = flagged.takeIf { it > 0 }?.toString(),
                badgeTone = Tone.Warning,
                onClick = onOpenFlaggedPhotos,
            )
        }
    }
}

@Composable
private fun Narrative(narrative: String, strings: BriefingStrings) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.md)) {
        SectionHeader(strings.aiSummary)

        KlinikCard(tone = Tone.Info) {
            Text(narrative, color = klinikColor("textPrimary"))
            // Required under every AI output (spec M5). Same card, always
            // visible — not a footnote the reader has to hunt for.
            Text(
                strings.aiDisclaimer,
                fontSize = Tokens.Typography.footnote.size,
                color = klinikColor("textSecondary"),
            )
        }
    }
}

/**
 * What the clinic did while nobody was looking.
 *
 * All five counts, every morning. They used to be filtered down to the ones
 * above zero, which reads as though the app had lost four of them — and a
 * doctor who cannot see that yesterday had no emergencies has not been told
 * that yesterday had no emergencies. A zero is an answer; it simply does not
 * get to wear the colour that means something happened.
 */
@Composable
private fun Yesterday(
    facts: xyz.klinik.network.BriefingYesterday,
    strings: BriefingStrings,
) {
    val metrics = listOf(
        Triple(strings.newMessages, facts.newMessages, Tone.Info),
        Triple(strings.urgentMessages, facts.urgentMessages, Tone.Warning),
        Triple(strings.emergencies, facts.emergencies, Tone.Critical),
        Triple(strings.complications, facts.complications, Tone.Warning),
        Triple(strings.criticalLabs, facts.criticalLabs, Tone.Critical),
    )

    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.md)) {
        SectionHeader(strings.yesterday)

        KlinikCard {
            metrics.forEachIndexed { index, (label, count, tone) ->
                if (index > 0) HorizontalDivider(color = klinikColor("border"))

                val quiet = count == 0

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = Tokens.minimumTouchTarget)
                        .semantics(mergeDescendants = true) {
                            contentDescription = "$label, $count"
                        },
                    horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.md),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        label,
                        color = klinikColor(if (quiet) "textSecondary" else "textPrimary"),
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        "$count",
                        color = klinikColor(if (quiet) "textDisabled" else tone.foreground),
                        fontSize = Tokens.Typography.heading.size,
                        fontWeight = Tokens.Typography.heading.weight,
                    )
                }
            }
        }
    }
}

/**
 * Everything else, by name.
 *
 * These are the overflow menu's entries, drawn. The menu stays — a habit is
 * worth keeping — but a feature reachable only from a menu is a feature most
 * people never learn the app has.
 */
@Composable
private fun Shortcuts(strings: BriefingStrings, onOpenTool: (StaffTool) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.md)) {
        SectionHeader(strings.shortcuts)

        FlowRow(horizontalSpacing = Tokens.Spacing.sm, verticalSpacing = Tokens.Spacing.sm) {
            for (tool in StaffTool.entries) {
                Text(
                    strings.toolName(tool),
                    color = klinikColor("accent"),
                    modifier = Modifier
                        .background(klinikColor("surface"), RoundedCornerShape(Tokens.Radius.md))
                        .clickable { onOpenTool(tool) }
                        .heightIn(min = Tokens.minimumTouchTarget)
                        .padding(horizontal = Tokens.Spacing.md, vertical = Tokens.Spacing.md),
                )
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
    val waited = if (item.showsHours) {
        strings.waitingHours(item.waitingHours)
    } else {
        strings.waitingMinutes(item.waitingMinutes)
    }

    val tone = when (item.kind) {
        RiskKind.EMERGENCY_UNANSWERED, RiskKind.COMPLICATION_OVERDUE -> Tone.Critical
        RiskKind.REPORT_UNREVIEWED -> Tone.Info
        else -> Tone.Warning
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpenPatient(item.patientId, item.patientName) }
            .semantics(mergeDescendants = true) {
                contentDescription =
                    "${item.patientName}, ${strings.riskName(item.kind)}, $waited, ${item.detail}"
            },
    ) {
        KlinikCard(tone = tone) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.md),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.clearAndSetSemantics { },
            ) {
                InitialsAvatar(item.patientName, diameter = 40.dp)

                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        item.patientName,
                        color = klinikColor("textPrimary"),
                        fontSize = Tokens.Typography.subheading.size,
                        fontWeight = Tokens.Typography.subheading.weight,
                    )
                    Text(
                        waited,
                        fontSize = Tokens.Typography.caption.size,
                        color = klinikColor("textSecondary"),
                    )
                }
            }

            Badge(strings.riskName(item.kind), tone = tone, modifier = Modifier.clearAndSetSemantics { })

            Text(
                item.detail,
                fontSize = Tokens.Typography.callout.size,
                color = klinikColor("textSecondary"),
                modifier = Modifier.clearAndSetSemantics { },
            )
        }
    }
}

private fun waitingText(minutes: Int, strings: BriefingStrings): String =
    if (minutes < 60) strings.waitingMinutes(minutes) else strings.waitingHours(minutes / 60)

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxWidth()
            .padding(Tokens.Spacing.xl),
    ) {
        content()
    }
}
