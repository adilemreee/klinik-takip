package xyz.klinik.app

import android.graphics.BitmapFactory
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import xyz.klinik.network.PhotosApi

/**
 * Decoded clinical photographs, fetched once per screen.
 *
 * Two things this is careful about. The signed URL is asked for, used and
 * dropped — it is short-lived and scoped to this reader, so nothing keeps one
 * past the draw. And a photograph that fails to load stays absent rather than
 * becoming a placeholder: a wound gallery showing the wrong picture, or a grey
 * square a clinician reads as "nothing here", is worse than a gap they can
 * see.
 *
 * Deliberately small. There is no disk cache and no request library: these are
 * a handful of images on a screen somebody opened on purpose, and a cache of
 * clinical photographs is a second copy to protect.
 */
@Composable
fun rememberPhotoImages(api: PhotosApi, ids: List<String>): (String) -> ImageBitmap? {
    val images: SnapshotStateMap<String, ImageBitmap> = remember(api) { mutableStateMapOf() }

    // Keyed on the joined ids so a changed list fetches what is new and a
    // recomposition with the same list fetches nothing.
    val key = ids.joinToString(",")

    LaunchedEffect(key) {
        for (id in ids) {
            if (images.containsKey(id)) continue

            val bitmap = withContext(Dispatchers.IO) {
                runCatching {
                    val link = api.link(id)

                    // The bytes come from object storage, not the API: the URL
                    // carries its own signature and must not be sent the
                    // session's bearer token.
                    URL(link.url).openStream().use { stream ->
                        BitmapFactory.decodeStream(stream)?.asImageBitmap()
                    }
                }.getOrNull()
            }

            if (bitmap != null) images[id] = bitmap
        }
    }

    return { id -> images[id] }
}
