package xyz.klinik.feature.complications.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.complications.ComplicationsPhase
import xyz.klinik.feature.complications.ComplicationsState
import xyz.klinik.network.ComplicationStatus
import xyz.klinik.network.ComplicationView
import xyz.klinik.network.UiText

/** Text the screens need, resolved by the caller from string resources. */
data class ComplicationStrings(
    val queueEmpty: String,
    val notFound: String,
    val retry: String,
    val answer: String,
    val resolve: String,
    val waiting: String,
    val respondedIn: String,
    val minutesShort: String,
    val overdueCount: String,
    val noBodyArea: String,
    val photoCount: String,
    val answered: String,
    val awaitingReply: String,
    val reportTitle: String,
    val reportHint: String,
    val whatIsWrong: String,
    val bodyArea: String,
    val send: String,
    val statusName: (ComplicationStatus) -> String,
    val message: (String) -> String,
)

/** The clinician's queue of reports still waiting (spec M7). */
@Composable
fun ComplicationQueueScreen(
    state: ComplicationsState,
    strings: ComplicationStrings,
    onRetry: () -> Unit,
    onAnswer: (ComplicationView) -> Unit,
    onResolve: (ComplicationView) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            ComplicationsPhase.Loading -> Centered { CircularProgressIndicator() }

            ComplicationsPhase.Empty -> Centered {
                Text(strings.queueEmpty, color = klinikColor("textSecondary"))
            }

            ComplicationsPhase.NotFound -> Centered {
                Text(strings.notFound, color = klinikColor("textSecondary"))
            }

            is ComplicationsPhase.Failed -> Centered {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
                ) {
                    Text(strings.message(phase.messageKey), color = klinikColor("critical"))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            ComplicationsPhase.Loaded -> Queue(state, strings, onAnswer, onResolve)
        }
    }
}

@Composable
private fun Queue(
    state: ComplicationsState,
    strings: ComplicationStrings,
    onAnswer: (ComplicationView) -> Unit,
    onResolve: (ComplicationView) -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        if (state.overdueCount > 0) {
            Text(
                "${strings.overdueCount}: ${state.overdueCount}",
                color = klinikColor("warning"),
                modifier = Modifier.padding(Tokens.Spacing.lg),
            )
        }

        state.error?.let { error ->
            val text = when (error) {
                is UiText.Key -> strings.message(error.key)
                is UiText.Literal -> error.text
            }

            Text(
                text,
                color = klinikColor("critical"),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Tokens.Spacing.lg)
                    .semantics { contentDescription = text },
            )
        }

        LazyColumn(modifier = Modifier.weight(1f)) {
            items(state.items, key = { it.complication.id }) { item ->
                QueueRow(
                    item = item,
                    strings = strings,
                    isWorking = state.working == item.complication.id,
                    onAnswer = { onAnswer(item) },
                    onResolve = { onResolve(item) },
                )
            }
        }
    }
}

@Composable
private fun QueueRow(
    item: ComplicationView,
    strings: ComplicationStrings,
    isWorking: Boolean,
    onAnswer: () -> Unit,
    onResolve: () -> Unit,
) {
    // How long the patient has been waiting, in words as well as colour: a wait
    // a reader cannot distinguish by hue is no signal at all (spec section 7).
    val waiting = item.responseMinutes
        ?.let { "${strings.respondedIn} $it ${strings.minutesShort}" }
        ?: "${strings.waiting} ${item.waitingMinutes} ${strings.minutesShort}"

    val spoken = "${item.complication.bodyArea ?: strings.noBodyArea}, " +
        "${item.complication.note}, $waiting"

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(Tokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
    ) {
        Column(
            modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = spoken },
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
        ) {
            Row(modifier = Modifier.fillMaxWidth()) {
                Text(
                    item.complication.bodyArea ?: strings.noBodyArea,
                    color = klinikColor("textPrimary"),
                    modifier = Modifier.weight(1f).clearAndSetSemantics {},
                )

                Text(
                    waiting,
                    color = klinikColor(if (item.overdue) "warning" else "textSecondary"),
                    modifier = Modifier.clearAndSetSemantics {},
                )
            }

            Text(
                item.complication.note,
                color = klinikColor("textPrimary"),
                modifier = Modifier.clearAndSetSemantics {},
            )
        }

        if (item.photos.isNotEmpty()) {
            Text(
                "${item.photos.size} ${strings.photoCount}",
                color = klinikColor("textSecondary"),
            )
        }

        item.complication.firstResponse?.let { response ->
            Text("${strings.answered}: $response", color = klinikColor("success"))
        }

        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
            if (item.complication.acknowledgedAt == null) {
                Button(
                    onClick = onAnswer,
                    enabled = !isWorking,
                    modifier = Modifier.height(Tokens.minimumTouchTarget),
                ) {
                    Text(strings.answer)
                }
            }

            if (item.complication.status != ComplicationStatus.RESOLVED) {
                TextButton(
                    onClick = onResolve,
                    enabled = !isWorking,
                    modifier = Modifier.height(Tokens.minimumTouchTarget),
                ) {
                    Text(strings.resolve)
                }
            }
        }
    }
}

/** The patient's side: reporting, and seeing what the clinic said back. */
@Composable
fun MyComplicationsScreen(
    state: ComplicationsState,
    strings: ComplicationStrings,
    onReport: (note: String, bodyArea: String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    var note by remember { mutableStateOf("") }
    var bodyArea by remember { mutableStateOf("") }

    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
        ) {
            // The form first: someone opening this screen is usually here to
            // report something, not to browse what they reported before.
            Text(strings.reportTitle, color = klinikColor("textPrimary"))
            Text(strings.reportHint, color = klinikColor("textSecondary"))

            OutlinedTextField(
                value = note,
                onValueChange = { note = it },
                label = { Text(strings.whatIsWrong) },
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = bodyArea,
                onValueChange = { bodyArea = it },
                label = { Text(strings.bodyArea) },
                modifier = Modifier.fillMaxWidth(),
            )

            state.error?.let { error ->
                val text = when (error) {
                    is UiText.Key -> strings.message(error.key)
                    is UiText.Literal -> error.text
                }

                Text(
                    text,
                    color = klinikColor("critical"),
                    modifier = Modifier.semantics { contentDescription = text },
                )
            }

            Button(
                onClick = {
                    onReport(note, bodyArea.ifBlank { null })
                    note = ""
                    bodyArea = ""
                },
                enabled = note.isNotBlank() && !state.submitting,
                modifier = Modifier.fillMaxWidth().height(Tokens.minimumTouchTarget),
            ) {
                Text(strings.send)
            }

            state.items.forEach { item ->
                MyReportRow(item, strings)
            }
        }
    }
}

@Composable
private fun MyReportRow(item: ComplicationView, strings: ComplicationStrings) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
    ) {
        Text(
            strings.statusName(item.complication.status),
            color = klinikColor("textSecondary"),
        )

        Text(item.complication.note, color = klinikColor("textPrimary"))

        // The reply, shown plainly. A patient who cannot see an answer reports
        // the same worry again.
        val response = item.complication.firstResponse

        if (response != null) {
            Surface(color = klinikColor("successSurface"), contentColor = klinikColor("success")) {
                Text(response, modifier = Modifier.padding(Tokens.Spacing.md))
            }
        } else {
            Text(strings.awaitingReply, color = klinikColor("textSecondary"))
        }
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}
