package xyz.klinik.feature.consents

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.ConsentForm
import xyz.klinik.network.ConsentType
import xyz.klinik.network.ConsentsApi
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface ConsentFormPhase {
    data object Loading : ConsentFormPhase
    data object Loaded : ConsentFormPhase

    /**
     * The clinic has not published the text.
     *
     * Its own state: a form that names no procedure is not a valid informed
     * consent, and the server withholds it rather than sending a template with
     * a blank in it.
     */
    data object Unpublished : ConsentFormPhase
    data object Signed : ConsentFormPhase
    data class Failed(val message: UiText) : ConsentFormPhase
}

data class ConsentFormState(
    val phase: ConsentFormPhase = ConsentFormPhase.Loading,
    val form: ConsentForm? = null,
    /**
     * Whether the reader has reached the end of the text.
     *
     * Not a formality: a consent agreed to without the text having been
     * scrolled through is one the clinic cannot say was read.
     */
    val readToEnd: Boolean = false,
    val signed: Boolean = false,
    val busy: Boolean = false,
    val error: UiText? = null,
) {
    val canSubmit: Boolean get() = form != null && readToEnd && signed && !busy
}

/**
 * The treatment consent (KVKK, spec §8).
 *
 * The text comes from the server rather than the app: the clinic's lawyer
 * changes it, and a version compiled into a release is a version somebody
 * signed that nobody can produce afterwards. What is signed goes back with the
 * consent, verbatim, as proof of what was shown.
 *
 * Two gates before the button works, and both are real. The text has to have
 * been scrolled to the end, because a consent nobody read is not informed. And
 * a signature has to have been drawn, because that is the instrument — a
 * consent record with a blank where the mark should be is one the clinic
 * cannot stand behind.
 */
class ConsentFormModel(
    private val api: ConsentsApi,
) {
    private val _state = MutableStateFlow(ConsentFormState())
    val state: StateFlow<ConsentFormState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = ConsentFormPhase.Loading)

        try {
            val form = api.form()

            _state.value = ConsentFormState(phase = ConsentFormPhase.Loaded, form = form)
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = when {
                    // The clinic has not recorded the procedure yet, so there
                    // is no text to show — not a failure of this screen.
                    error is ApiError.NotFound -> ConsentFormPhase.Unpublished
                    else -> ConsentFormPhase.Failed(messageFor(error))
                },
            )
        }
    }

    fun markReadToEnd() {
        _state.value = _state.value.copy(readToEnd = true)
    }

    fun setSigned(signed: Boolean) {
        _state.value = _state.value.copy(signed = signed)
    }

    /**
     * Records the consent with the text that was shown and the mark that was
     * made.
     *
     * Both travel with it. The version alone names a wording; the text is what
     * this person actually saw, and the signature is what they did about it.
     */
    suspend fun sign(signaturePng: String?): Boolean {
        val form = _state.value.form ?: return false
        if (!_state.value.canSubmit) return false

        _state.value = _state.value.copy(busy = true, error = null)

        return try {
            api.give(
                type = ConsentType.TREATMENT,
                version = form.version,
                documentText = form.body,
                signature = signaturePng,
            )

            _state.value = _state.value.copy(phase = ConsentFormPhase.Signed, busy = false)
            true
        } catch (error: Throwable) {
            // The form stays open with the signature on it: asking somebody to
            // read a consent form and sign it twice because the network
            // dropped is how people stop reading it.
            _state.value = _state.value.copy(busy = false, error = messageFor(error))
            false
        }
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
