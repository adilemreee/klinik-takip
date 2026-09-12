package xyz.klinik.feature.photos

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.FlaggedPhoto
import xyz.klinik.network.PhotosApi
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface FlaggedPhase {
    data object Loading : FlaggedPhase
    data object Loaded : FlaggedPhase

    /** Nothing flagged. The good state, and worth saying rather than drawing blank. */
    data object Empty : FlaggedPhase

    /** Not a failure: the photo endpoints need `photos.read`. */
    data object NotPermitted : FlaggedPhase
    data class Failed(val message: UiText) : FlaggedPhase
}

data class FlaggedPhotosState(
    val phase: FlaggedPhase = FlaggedPhase.Loading,
    /** Oldest first: the one that has been waiting longest for a look. */
    val photos: List<FlaggedPhoto> = emptyList(),
    val busyId: String? = null,
    val error: UiText? = null,
)

/**
 * The wound photographs an assessment thought somebody should look at (M5).
 *
 * A flag, never a diagnosis. The findings come from a closed vocabulary — the
 * server drops anything outside it rather than passing it through — and the
 * disclaimer travels with every row, because a list of photographs headed
 * "redness, discharge" reads as a conclusion unless it says otherwise.
 *
 * Oldest first, deliberately. This is a queue of work, and the photograph that
 * has been waiting since Tuesday is the one somebody should see.
 */
class FlaggedPhotosModel(private val api: PhotosApi) {
    private val _state = MutableStateFlow(FlaggedPhotosState())
    val state: StateFlow<FlaggedPhotosState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = FlaggedPhase.Loading)

        try {
            val photos = api.flagged().sortedBy { it.takenAt }

            _state.value = FlaggedPhotosState(
                phase = if (photos.isEmpty()) FlaggedPhase.Empty else FlaggedPhase.Loaded,
                photos = photos,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = if (error is ApiError.Forbidden) {
                    FlaggedPhase.NotPermitted
                } else {
                    FlaggedPhase.Failed(messageFor(error))
                },
            )
        }
    }

    /**
     * Runs the assessment again on one photograph.
     *
     * The row is replaced with what came back rather than removed: a
     * re-assessment that found nothing is an answer about that photograph, and
     * a clinician who watched it vanish would not know which it was.
     */
    suspend fun reassess(photo: FlaggedPhoto): Boolean {
        _state.value = _state.value.copy(busyId = photo.id, error = null)

        return try {
            val assessment = api.assess(photo.id)

            _state.value = _state.value.copy(
                // The assessment answers about the photograph; the patient it
                // belongs to is not part of that answer and is kept from the
                // row we already have.
                photos = _state.value.photos.map {
                    if (it.id == photo.id) {
                        it.copy(
                            aiReviewSuggested = assessment.photo.aiReviewSuggested,
                            aiFindings = assessment.photo.aiFindings,
                            aiAssessedAt = assessment.photo.aiAssessedAt,
                        )
                    } else {
                        it
                    }
                },
                busyId = null,
            )

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busyId = null, error = messageFor(error))
            false
        }
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
