package xyz.klinik.feature.photos.ui

import androidx.compose.ui.graphics.ImageBitmap

/**
 * A photograph on its way to the screen.
 *
 * Three states, because two are not enough. The loader used to hand back a
 * nullable bitmap and record nothing when a fetch failed, so "still coming"
 * and "never coming" were the same value — and the card, which drew the image
 * only when it was there, showed neither a spinner nor an explanation. A
 * clinician looking at a flagged wound saw an empty card.
 *
 * `Unavailable` still shows no stand-in picture: a wrong photograph on a
 * clinical card is worse than no photograph. A sentence saying it did not
 * arrive is neither.
 */
sealed interface PhotoImage {
    data object Loading : PhotoImage
    data class Ready(val bitmap: ImageBitmap) : PhotoImage
    data object Unavailable : PhotoImage
}
