package xyz.klinik.feature.photos.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.photos.FlaggedPhase
import xyz.klinik.feature.photos.FlaggedPhotosState
import xyz.klinik.network.FlaggedPhoto
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class FlaggedPhotosStrings(
    val title: String,
    val empty: String,
    val notPermitted: String,
    val retry: String,
    val reviewSuggested: String,
    val clean: String,
    val notAssessed: String,
    val disclaimer: String,
    val assessAgain: String,
    val openFile: String,
    val noBodyArea: String,
    val findingName: (String) -> String,
    val imageLabel: String,
    val message: (UiText) -> String,
)

/**
 * The wound photographs an assessment thought somebody should look at (M5).
 *
 * The disclaimer is under every row, not once at the top. A list headed
 * "redness, discharge" reads as a set of conclusions, and a clinician
 * scrolling past the top of the screen would never see a notice that sat
 * there — this is a flag asking for a look, not a diagnosis.
 *
 * Oldest first: a queue of work, where the photograph that has been waiting
 * since Tuesday is the one somebody should see.
 */
@Composable
fun FlaggedPhotosScreen(
    state: FlaggedPhotosState,
    strings: FlaggedPhotosStrings,
    /**
     * Decoded image for a photo, supplied by the caller.
     *
     * Kept out of here so the screen carries no image-loading dependency and
     * never holds a signed URL longer than it draws it — those are short-lived
     * on purpose.
     */
    imageFor: (String) -> ImageBitmap?,
    onReassess: (FlaggedPhoto) -> Unit,
    onOpenFile: (FlaggedPhoto) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            FlaggedPhase.Loading -> Centred { CircularProgressIndicator() }

            // Nothing waiting is the good state.
            FlaggedPhase.Empty -> Centred {
                Text(
                    strings.empty,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            FlaggedPhase.NotPermitted -> Centred {
                Text(
                    strings.notPermitted,
                    color = klinikColor("textSecondary"),
                    textAlign = TextAlign.Center,
                )
            }

            is FlaggedPhase.Failed -> Centred {
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

            FlaggedPhase.Loaded -> Column(
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

                state.photos.forEach { photo ->
                    PhotoCard(photo, state, strings, imageFor, onReassess, onOpenFile)
                }
            }
        }
    }
}

@Composable
private fun PhotoCard(
    photo: FlaggedPhoto,
    state: FlaggedPhotosState,
    strings: FlaggedPhotosStrings,
    imageFor: (String) -> ImageBitmap?,
    onReassess: (FlaggedPhoto) -> Unit,
    onOpenFile: (FlaggedPhoto) -> Unit,
) {
    val busy = state.busyId == photo.id

    Surface(color = klinikColor("surface"), modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
        ) {
            imageFor(photo.id)?.let { bitmap ->
                Image(
                    bitmap = bitmap,
                    contentDescription = strings.imageLabel,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxWidth().height(220.dp),
                )
            }

            Row(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.weight(1f)) {
                    // Whose wound it is, first: this is a worklist, and a row
                    // that names only a body area is one nobody can act on.
                    Text(photo.patientName, color = klinikColor("textPrimary"))
                    Text(
                        "${photo.mrn} · ${photo.bodyArea ?: strings.noBodyArea}",
                        fontSize = Tokens.Typography.caption.size,
                        color = klinikColor("textSecondary"),
                    )
                }

                Text(
                    photo.takenAt.take(10),
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("textSecondary"),
                )
            }

            // Three states, not two: nobody looked, somebody looked and found
            // nothing, and somebody looked and thinks a clinician should.
            Text(
                when {
                    photo.needsReview -> strings.reviewSuggested
                    photo.isAssessedClean -> strings.clean
                    else -> strings.notAssessed
                },
                color = when {
                    photo.needsReview -> klinikColor("warning")
                    photo.isAssessedClean -> klinikColor("success")
                    else -> klinikColor("textSecondary")
                },
            )

            // From a closed vocabulary. Never a condition name.
            photo.findingKeys().forEach { key ->
                Text(
                    strings.findingName(key),
                    fontSize = Tokens.Typography.caption.size,
                    color = klinikColor("textSecondary"),
                )
            }

            // Under every row, because a list headed "redness, discharge"
            // reads as a set of conclusions.
            Text(
                strings.disclaimer,
                fontSize = Tokens.Typography.footnote.size,
                color = klinikColor("textSecondary"),
            )

            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
                TextButton(
                    onClick = { onOpenFile(photo) },
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.openFile)
                }

                TextButton(
                    onClick = { onReassess(photo) },
                    enabled = !busy,
                    modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(strings.assessAgain)
                }
            }
        }
    }
}

@Composable
private fun Centred(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Tokens.Spacing.xl),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { content() }
    }
}
