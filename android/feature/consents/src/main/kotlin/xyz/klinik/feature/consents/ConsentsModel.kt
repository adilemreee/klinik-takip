package xyz.klinik.feature.consents

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import xyz.klinik.network.ApiError
import xyz.klinik.network.Consent
import xyz.klinik.network.ConsentType
import xyz.klinik.network.ConsentsApi
import xyz.klinik.network.messageKey

sealed interface ConsentsPhase {
    data object Loading : ConsentsPhase
    data object Loaded : ConsentsPhase
    data object NotFound : ConsentsPhase
    data class Failed(val messageKey: String) : ConsentsPhase
}

data class ConsentsState(
    val phase: ConsentsPhase = ConsentsPhase.Loading,
    val consents: List<Consent> = emptyList(),
    /** The type being changed, so its button can be disabled. */
    val working: ConsentType? = null,
    val error: String? = null,
) {
    /** The one in force now, if any. A withdrawn record is not one. */
    fun active(type: ConsentType): Consent? =
        consents.firstOrNull { it.type == type && it.active }

    /** The most recent record of a type, in force or not — the history line. */
    fun latest(type: ConsentType): Consent? =
        consents.filter { it.type == type }.maxByOrNull { it.signedAt }
}

/**
 * Giving and withdrawing consent (KVKK, spec §8).
 *
 * The screen this drives follows Board decision 2026/347: the notice and the
 * consent are separate, the notice takes only an acknowledgement that it was
 * read, and nothing is asked for where a non-consent ground applies.
 * [ConsentType.askable] is where that last rule lives, and this model never
 * sends anything else — the server refuses it too, because a client that sends
 * it is one somebody could point at a laxer server.
 *
 * Withdrawal is as easy as giving, and on the same screen. A consent that can
 * only be taken back by e-mailing the clinic is one made harder to withdraw
 * than to give.
 */
class ConsentsModel(
    private val api: ConsentsApi,
    /**
     * Which wording is being agreed to. Sent with every consent because "they
     * agreed" names nothing without it, and a text changed later must not
     * silently inherit agreement to the old one.
     */
    private val version: Int = 1,
) {
    private val _state = MutableStateFlow(ConsentsState())
    val state: StateFlow<ConsentsState> = _state.asStateFlow()

    private val changeLock = Mutex()

    suspend fun load() {
        _state.value = _state.value.copy(phase = ConsentsPhase.Loading, error = null)

        _state.value = try {
            _state.value.copy(phase = ConsentsPhase.Loaded, consents = api.mine())
        } catch (error: ApiError) {
            // No patient file linked yet. Nothing to fetch until the clinic
            // links one, so not a failure to retry.
            val phase = if (error is ApiError.NotFound) {
                ConsentsPhase.NotFound
            } else {
                ConsentsPhase.Failed(error.messageKey())
            }

            _state.value.copy(phase = phase)
        }
    }

    suspend fun give(type: ConsentType): Boolean {
        if (type !in ConsentType.askable) return false

        return change(type) { api.give(type, version) }
    }

    suspend fun withdraw(type: ConsentType): Boolean {
        val consent = _state.value.active(type) ?: return false

        return change(type) { api.withdraw(consent.id) }
    }

    private suspend fun change(type: ConsentType, work: suspend () -> Unit): Boolean {
        changeLock.withLock {
            if (_state.value.working != null) return false

            _state.value = _state.value.copy(working = type, error = null)

            try {
                work()
            } catch (error: ApiError) {
                _state.value = _state.value.copy(working = null, error = error.messageKey())
                return false
            }

            _state.value = _state.value.copy(working = null)
        }

        // Reloaded rather than patched locally: giving a consent supersedes the
        // previous one server-side, and a local edit would leave the screen
        // showing two.
        load()

        return true
    }
}
