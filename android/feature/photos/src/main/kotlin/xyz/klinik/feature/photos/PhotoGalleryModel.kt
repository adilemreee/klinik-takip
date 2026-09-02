package xyz.klinik.feature.photos

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import xyz.klinik.network.ApiError
import xyz.klinik.network.ClinicalPhoto
import xyz.klinik.network.GalleryGroup
import xyz.klinik.network.PhotoCategory
import xyz.klinik.network.PhotosApi
import xyz.klinik.network.UiText
import xyz.klinik.network.messageKey
import xyz.klinik.network.uiText

sealed interface GalleryPhase {
    data object Loading : GalleryPhase
    data object Loaded : GalleryPhase

    /** No photos yet. Not a failure. */
    data object Empty : GalleryPhase

    data object NotFound : GalleryPhase
    data class Failed(val messageKey: String) : GalleryPhase
}

/** The two photos a comparison shows, and which way round they go. */
data class ComparisonPair(val before: ClinicalPhoto, val after: ClinicalPhoto)

data class GalleryState(
    val phase: GalleryPhase = GalleryPhase.Loading,
    val groups: List<GalleryGroup> = emptyList(),
    val selectedArea: String? = null,
    val uploading: Boolean = false,
    val error: UiText? = null,
) {
    val selectedGroup: GalleryGroup?
        get() = groups.firstOrNull { it.id == selectedArea } ?: groups.firstOrNull()

    /**
     * The pair a comparison opens on: the earliest and the latest of the
     * selected body area.
     *
     * Null for a single photo, because a slider over one image does nothing and
     * offering it suggests there is a change to see.
     */
    val comparison: ComparisonPair?
        get() {
            val photos = selectedGroup?.photos ?: return null
            if (photos.size < 2) return null

            return ComparisonPair(photos.first(), photos.last())
        }
}

/** The before/after gallery (spec M7). */
class PhotoGalleryModel(
    private val api: PhotosApi,
    private val patientId: String,
) {
    private val _state = MutableStateFlow(GalleryState())
    val state: StateFlow<GalleryState> = _state.asStateFlow()

    private val uploadLock = Mutex()

    suspend fun load(category: PhotoCategory? = null) {
        _state.value = _state.value.copy(phase = GalleryPhase.Loading)

        try {
            val groups = api.gallery(patientId, category)

            _state.value = _state.value.copy(
                groups = groups,
                selectedArea = groups.firstOrNull()?.id,
                phase = if (groups.isEmpty()) GalleryPhase.Empty else GalleryPhase.Loaded,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = if (error is ApiError.NotFound) {
                    GalleryPhase.NotFound
                } else {
                    GalleryPhase.Failed((error as? ApiError)?.messageKey() ?: "error.server")
                },
            )
        }
    }

    fun select(area: String) {
        _state.value = _state.value.copy(selectedArea = area)
    }

    /** The photo a new capture lines up against, for the translucent guide. */
    suspend fun overlayReference(bodyArea: String): ClinicalPhoto? =
        runCatching { api.overlayReference(patientId, bodyArea) }.getOrNull()

    suspend fun upload(
        path: String,
        filename: String,
        category: PhotoCategory,
        bodyArea: String? = null,
        phaseLabel: String? = null,
    ): Boolean {
        if (!uploadLock.tryLock()) return false

        _state.value = _state.value.copy(uploading = true, error = null)

        try {
            api.upload(patientId, path, filename, category, bodyArea, phaseLabel)
        } catch (error: Throwable) {
            // The server refuses a format whose location data it cannot strip,
            // and says so. Replacing that with our own message would leave the
            // person guessing why a perfectly good photo was rejected.
            _state.value = _state.value.copy(
                uploading = false,
                error = (error as? ApiError)?.uiText() ?: UiText.Key("error.server"),
            )
            return false
        } finally {
            uploadLock.unlock()
        }

        // Reloaded rather than appended: the server decides the stored type and
        // the grouping, and a guessed row would disagree after the next refresh.
        load()
        _state.value = _state.value.copy(uploading = false)
        return true
    }

    suspend fun remove(photoId: String) {
        try {
            api.remove(photoId)
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                error = (error as? ApiError)?.uiText() ?: UiText.Key("error.server"),
            )
            return
        }

        load()
    }
}
