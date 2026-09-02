package xyz.klinik.feature.photos.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.photos.ComparisonPair
import xyz.klinik.feature.photos.GalleryPhase
import xyz.klinik.feature.photos.GalleryState
import xyz.klinik.network.ClinicalPhoto
import xyz.klinik.network.PhotoCategory
import xyz.klinik.network.UiText

/** Text the screen needs, resolved by the caller from string resources. */
data class PhotoStrings(
    val empty: String,
    val notFound: String,
    val retry: String,
    val compare: String,
    val compareSlider: String,
    val before: String,
    val after: String,
    val consentGiven: String,
    val clinicalUseOnly: String,
    val noBodyArea: String,
    val categoryName: (PhotoCategory) -> String,
    val message: (String) -> String,
)

@Composable
fun PhotoGalleryScreen(
    state: GalleryState,
    strings: PhotoStrings,
    /**
     * Decoded image for a photo, supplied by the caller.
     *
     * Kept out of here so the screen carries no image-loading dependency and
     * never holds a signed URL longer than it draws it — those URLs are short
     * lived on purpose.
     */
    imageFor: (String) -> ImageBitmap?,
    onRetry: () -> Unit,
    onSelectArea: (String) -> Unit,
    onCompare: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        when (val phase = state.phase) {
            GalleryPhase.Loading -> Centered { CircularProgressIndicator() }

            GalleryPhase.Empty -> Centered {
                Text(strings.empty, color = klinikColor("textSecondary"))
            }

            GalleryPhase.NotFound -> Centered {
                Text(strings.notFound, color = klinikColor("textSecondary"))
            }

            is GalleryPhase.Failed -> Centered {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
                ) {
                    Text(strings.message(phase.messageKey), color = klinikColor("critical"))
                    TextButton(onClick = onRetry) { Text(strings.retry) }
                }
            }

            GalleryPhase.Loaded ->
                Gallery(state, strings, imageFor, onSelectArea, onCompare)
        }
    }
}

@Composable
private fun Gallery(
    state: GalleryState,
    strings: PhotoStrings,
    imageFor: (String) -> ImageBitmap?,
    onSelectArea: (String) -> Unit,
    onCompare: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
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
                    .padding(Tokens.Spacing.lg)
                    .semantics { contentDescription = text },
            )
        }

        Row(
            modifier = Modifier.padding(horizontal = Tokens.Spacing.lg),
            horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
        ) {
            state.groups.forEach { group ->
                val label = group.bodyArea ?: strings.noBodyArea

                if (group.id == state.selectedGroup?.id) {
                    Button(
                        onClick = { onSelectArea(group.id) },
                        modifier = Modifier.height(Tokens.minimumTouchTarget),
                    ) {
                        Text(label)
                    }
                } else {
                    TextButton(
                        onClick = { onSelectArea(group.id) },
                        modifier = Modifier.height(Tokens.minimumTouchTarget),
                    ) {
                        Text(label)
                    }
                }
            }
        }

        LazyColumn(modifier = Modifier.weight(1f)) {
            items(state.selectedGroup?.photos.orEmpty(), key = { it.id }) { photo ->
                PhotoRow(photo, strings, imageFor(photo.id))
            }
        }

        // Offered only when there are two photos to compare.
        if (state.comparison != null) {
            Button(
                onClick = onCompare,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(Tokens.Spacing.lg)
                    .height(Tokens.minimumTouchTarget),
            ) {
                Text(strings.compare)
            }
        }
    }
}

@Composable
private fun PhotoRow(photo: ClinicalPhoto, strings: PhotoStrings, image: ImageBitmap?) {
    val consentText = if (photo.hasUsageConsent) strings.consentGiven else strings.clinicalUseOnly
    val label = photo.phaseLabel ?: strings.categoryName(photo.category)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(Tokens.Spacing.lg)
            .semantics(mergeDescendants = true) {
                contentDescription = "$label, ${photo.takenAt}, $consentText"
            },
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
    ) {
        PhotoImage(image, Modifier.fillMaxWidth().height(200.dp))

        Text(label, color = klinikColor("textPrimary"), modifier = Modifier.clearAndSetSemantics {})

        // Said on the photo itself rather than in a settings screen: whether
        // this image may be used outside the clinic is a fact about the image.
        Text(
            consentText,
            color = klinikColor(if (photo.hasUsageConsent) "success" else "textSecondary"),
            modifier = Modifier.clearAndSetSemantics {},
        )
    }
}

/** Two photos with a divider the reader drags (spec M7: slider comparison). */
@Composable
fun PhotoComparisonScreen(
    pair: ComparisonPair,
    strings: PhotoStrings,
    imageFor: (String) -> ImageBitmap?,
    modifier: Modifier = Modifier,
) {
    var split by remember { mutableFloatStateOf(0.5f) }

    Surface(color = klinikColor("background"), modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.padding(Tokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg),
        ) {
            BoxWithConstraints(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(360.dp)
                    .clipToBounds()
                    .pointerInput(Unit) {
                        detectHorizontalDragGestures { change, _ ->
                            split = (change.position.x / size.width).coerceIn(0f, 1f)
                        }
                    }
                    // The images are decoration here; the labels below name
                    // which is which, and the slider carries the interaction.
                    .clearAndSetSemantics {},
            ) {
                val full = maxWidth

                PhotoImage(imageFor(pair.after.id), Modifier.fillMaxSize())

                // The "before" image is drawn at full width inside a narrower
                // box that clips it. Scaling it to the box instead would squash
                // the picture as the divider moved, which is exactly the
                // distortion a before/after comparison must not introduce.
                Box(modifier = Modifier.width(full * split).fillMaxHeight().clipToBounds()) {
                    PhotoImage(imageFor(pair.before.id), Modifier.width(full).fillMaxHeight())
                }

                Box(
                    modifier = Modifier
                        .offset(x = full * split)
                        .width(2.dp)
                        .fillMaxHeight()
                        .background(klinikColor("accent")),
                )
            }

            // The divider is a drag gesture, which a screen reader cannot
            // perform. The same comparison is reachable as a value it can set.
            Slider(
                value = split,
                onValueChange = { split = it },
                modifier = Modifier.semantics {
                    contentDescription = strings.compareSlider
                },
            )

            Row(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(strings.before, color = klinikColor("textSecondary"))
                    Text(
                        pair.before.phaseLabel ?: strings.categoryName(pair.before.category),
                        color = klinikColor("textPrimary"),
                    )
                }

                Column(horizontalAlignment = Alignment.End) {
                    Text(strings.after, color = klinikColor("textSecondary"))
                    Text(
                        pair.after.phaseLabel ?: strings.categoryName(pair.after.category),
                        color = klinikColor("textPrimary"),
                    )
                }
            }
        }
    }
}

@Composable
private fun PhotoImage(image: ImageBitmap?, modifier: Modifier) {
    if (image == null) {
        // A grey rectangle rather than an icon: the caller may still be minting
        // the signed URL, and a failure symbol for a photo that is merely late
        // reads as a photo that is gone.
        Box(modifier = modifier.background(klinikColor("surface")))
        return
    }

    Image(
        bitmap = image,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = modifier,
    )
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}
