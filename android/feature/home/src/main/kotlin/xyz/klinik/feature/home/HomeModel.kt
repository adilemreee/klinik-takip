package xyz.klinik.feature.home

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.MeApi
import xyz.klinik.network.PatientHomeSummary
import xyz.klinik.network.messageKey

/**
 * The five things a patient can do from the home screen (spec section 7).
 *
 * Fixed and exhaustive: the limit is the point. A sixth action would be a
 * decision to make the screen harder for the people least able to absorb it.
 */
enum class HomeAction(val iconName: String, val titleKey: String) {
    MESSAGES("bubble.left.and.bubble.right", "home.action.messages"),
    UPLOAD_DOCUMENT("doc.badge.plus", "home.action.uploadDocument"),
    MEDICATIONS("pills", "home.action.medications"),
    ADD_PHOTO("camera", "home.action.addPhoto"),
    EMERGENCY("exclamationmark.triangle.fill", "home.action.emergency"),
}

sealed interface HomePhase {
    data object Loading : HomePhase
    data class Loaded(val summary: PatientHomeSummary) : HomePhase

    /** The account exists but is not linked to a patient file. */
    data object NoPatientFile : HomePhase

    data class Failed(val messageKey: String) : HomePhase
}

data class HomeState(
    val phase: HomePhase = HomePhase.Loading,
    /**
     * Counts shown on the action tiles. An absent entry means no badge, which
     * is different from zero — a zero badge is noise.
     */
    val badges: Map<HomeAction, Int> = emptyMap(),
)

class HomeModel(private val api: MeApi) {
    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = HomeState(phase = HomePhase.Loading)

        _state.value = try {
            val summary = api.summary()
            HomeState(phase = HomePhase.Loaded(summary), badges = badgesFor(summary))
        } catch (error: Throwable) {
            // Not a failure to retry: the account simply has no file yet, so
            // the screen explains rather than offering a button that cannot help.
            if (error is ApiError.NotFound) {
                HomeState(phase = HomePhase.NoPatientFile)
            } else {
                HomeState(
                    phase = HomePhase.Failed((error as? ApiError)?.messageKey() ?: "error.server"),
                )
            }
        }
    }

    companion object {
        /**
         * Only non-zero counts become badges: a tile reading "0" tells the
         * reader nothing and competes for attention with the ones that matter.
         */
        fun badgesFor(summary: PatientHomeSummary): Map<HomeAction, Int> = buildMap {
            if (summary.unreadMessages > 0) put(HomeAction.MESSAGES, summary.unreadMessages)
            if (summary.medicationsDueToday > 0) put(HomeAction.MEDICATIONS, summary.medicationsDueToday)
            if (summary.missingDocuments > 0) put(HomeAction.UPLOAD_DOCUMENT, summary.missingDocuments)
        }
    }
}
