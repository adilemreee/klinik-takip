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
import androidx.compose.foundation.layout.PaddingValues
import xyz.klinik.design.Badge
import xyz.klinik.design.FlowRow
import xyz.klinik.design.KlinikCard
import xyz.klinik.design.Tone
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import xyz.klinik.design.PhotoImage

/** Text the screens need, resolved by the caller from string resources. */
data class ComplicationStrings(
    val queueEmpty: String,
    val notFound: String,
    val retry: String,
    val answer: String,
    val resolve: String,
    /// How long, in words: "372 dk" is a number a clinician has to divide.
    val waitingFor: (Int) -> String,
    val respondedIn: (Int) -> String,
    val minutesShort: String,
    val overdueCount: (Int) -> String,
    val overdue: String,
    val loadFailed: String,
    val noBodyArea: String,
    val photoCount: (Int) -> String,
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
    /**
     * Decoded thumbnails for the attached photographs, supplied by the caller
     * so this module carries no image-loading dependency. Null leaves the
     * count as it was.
     */
    imageFor: ((String) -> PhotoImage)? = null,
    /**
     * Opening the report's photographs. The whole report rather than the one
     * photo: this client has no full-screen viewer, so the honest destination
     * is that patient's gallery.
     */
    onOpenPhotos: ((ComplicationView) -> Unit)? = null,
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

            ComplicationsPhase.Loaded ->
                Queue(state, strings, imageFor, onOpenPhotos, onAnswer, onResolve)
        }
    }
}

@Composable
private fun Queue(
    state: ComplicationsState,
    strings: ComplicationStrings,
    imageFor: ((String) -> PhotoImage)?,
    onOpenPhotos: ((ComplicationView) -> Unit)?,
    onAnswer: (ComplicationView) -> Unit,
    onResolve: (ComplicationView) -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        if (state.overdueCount > 0) {
            Text(
                strings.overdueCount(state.overdueCount),
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

        // Cards, like every other clinical list here. A plain list gave an
        // unanswered six-hour-old report exactly the presence of a
        // forty-minute one.
        LazyColumn(
            modifier = Modifier.weight(1f).padding(horizontal = Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.md),
            contentPadding = PaddingValues(vertical = Tokens.Spacing.md),
        ) {
            items(state.items, key = { it.complication.id }) { item ->
                QueueRow(
                    item = item,
                    strings = strings,
                    imageFor = imageFor,
                    onOpenPhotos = onOpenPhotos,
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
    imageFor: ((String) -> PhotoImage)?,
    onOpenPhotos: ((ComplicationView) -> Unit)?,
    isWorking: Boolean,
    onAnswer: () -> Unit,
    onResolve: () -> Unit,
) {
    // How long the patient has been waiting, in words as well as colour: a wait
    // a reader cannot distinguish by hue is no signal at all (spec section 7).
    val waiting = item.responseMinutes
        ?.let { strings.respondedIn(it) }
        ?: strings.waitingFor(item.waitingMinutes)

    val spoken = "${item.patient.fullName}, " +
        "${item.complication.bodyArea ?: strings.noBodyArea}, " +
        "${item.complication.note}, $waiting"

    KlinikCard(tone = toneFor(item)) {
        Column(
            modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = spoken },
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
        ) {
            Row(modifier = Modifier.fillMaxWidth()) {
                // Whose report it is, first. This queue is clinic-wide: a row
                // that opened with a body area left a clinician reading
                // "karın" with no idea whose abdomen.
                Column(modifier = Modifier.weight(1f).clearAndSetSemantics {}) {
                    Text(item.patient.fullName, color = klinikColor("textPrimary"))
                    Text(
                        "${item.patient.mrn} · " +
                            (item.complication.bodyArea ?: strings.noBodyArea),
                        fontSize = Tokens.Typography.caption.size,
                        color = klinikColor("textSecondary"),
                    )
                }

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

        FlowRow {
            Badge(strings.statusName(item.complication.status), tone = toneFor(item))

            if (item.overdue) {
                Badge(strings.overdue, tone = Tone.Warning)
            }
        }

        // The photographs, not a count of them. A patient reporting that a
        // wound is leaking attaches pictures of it; the queue used to say
        // "2 fotoğraf" in grey text and stop there.
        if (item.photos.isNotEmpty()) {
            if (imageFor == null) {
                Text(
                    strings.photoCount(item.photos.size),
                    color = klinikColor("textSecondary"),
                )
            } else {
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
                ) {
                    for (photo in item.photos) {
                        Thumbnail(
                            image = imageFor(photo.id),
                            label = strings.photoCount(item.photos.size),
                            loadFailed = strings.loadFailed,
                            onClick = { onOpenPhotos?.invoke(item) },
                        )
                    }
                }
            }
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

/**
 * Unanswered past the clinic threshold shouts; a closed report recedes; the
 * rest is ordinary.
 */
private fun toneFor(item: ComplicationView): Tone = when {
    item.overdue -> Tone.Warning
    item.complication.status == ComplicationStatus.RESOLVED -> Tone.Success
    else -> Tone.Neutral
}

/** One attached photograph, small and openable. */
@Composable
private fun Thumbnail(
    image: PhotoImage,
    label: String,
    loadFailed: String,
    onClick: () -> Unit,
) {
    val frame = Modifier
        .size(88.dp)
        .background(klinikColor("surface"), RoundedCornerShape(Tokens.Radius.md))
        .clickable(onClick = onClick)

    when (image) {
        is PhotoImage.Ready -> Image(
            bitmap = image.bitmap,
            contentDescription = label,
            contentScale = ContentScale.Crop,
            modifier = frame,
        )

        PhotoImage.Loading -> Box(modifier = frame)

        PhotoImage.Unavailable -> Box(modifier = frame, contentAlignment = Alignment.Center) {
            Text(
                loadFailed,
                color = klinikColor("textSecondary"),
                fontSize = Tokens.Typography.footnote.size,
                textAlign = TextAlign.Center,
            )
        }
    }
}
