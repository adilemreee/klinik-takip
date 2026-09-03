package xyz.klinik.feature.emergency

import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withTimeout
import xyz.klinik.network.ApiError
import xyz.klinik.network.EmergencyApi
import xyz.klinik.network.EmergencyEvent
import xyz.klinik.network.EmergencyGuidance
import xyz.klinik.network.EmergencyStatus
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

data class Coordinates(val latitude: Double, val longitude: Double)

/**
 * Whatever the app uses for location. Behind an interface so the model can be
 * tested against a locator that never answers, which is the case that matters.
 */
fun interface EmergencyLocating {
    suspend fun currentLocation(): Coordinates?
}

sealed interface EmergencyPhase {
    /** Nothing has happened. The button is on screen. */
    data object Idle : EmergencyPhase

    /** Pressed once. The second press within the window sends it. */
    data object Armed : EmergencyPhase

    data object Sending : EmergencyPhase

    /** The alarm is with the clinic. */
    data object Raised : EmergencyPhase

    /** The request failed. The card stays on screen — see [EmergencyState.card]. */
    data class Failed(val message: UiText) : EmergencyPhase
}

data class EmergencyState(
    val phase: EmergencyPhase = EmergencyPhase.Idle,
    val event: EmergencyEvent? = null,
    /**
     * The card, from whichever source had it.
     *
     * Kept separately from the response so a failed trigger still shows the
     * emergency number. That is the whole point: if the network is gone, the
     * one thing on this screen that still works is a phone call, and it must
     * not disappear because a POST failed.
     */
    val card: EmergencyGuidance? = null,
    val alreadyOpen: Boolean = false,
) {
    val canCancel: Boolean get() = event?.status == EmergencyStatus.TRIGGERED
}

/**
 * The emergency button (spec M8).
 *
 * Three rules, in order of how badly they fail:
 *
 *   1. **Two presses, not one.** A single button that raises a clinical alarm
 *      will be pressed by a pocket. The arming window closes on its own, so a
 *      pocket that armed it does not leave it primed for the next pocket.
 *   2. **The location never delays the alarm.** A cold GPS takes fifteen
 *      seconds. The request goes with whatever is known by then, and without
 *      anything if that is nothing.
 *   3. **A failure still leaves a phone number on screen.** The network being
 *      down is exactly when the local ambulance matters most.
 */
class EmergencyModel(
    private val api: EmergencyApi,
    private val locator: EmergencyLocating? = null,
    private val locationTimeoutMillis: Long = 4_000,
    private val armedWindowMillis: Long = 10_000,
    /** Injected so the arming window can be tested without waiting for it. */
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val _state = MutableStateFlow(EmergencyState())
    val state: StateFlow<EmergencyState> = _state.asStateFlow()

    private val sending = Mutex()
    private var armedAt: Long? = null

    /** Loaded when the screen appears, long before anything is wrong. */
    suspend fun prefetch() {
        val open = runCatching { api.active() }.getOrNull()

        if (open != null) {
            _state.value = _state.value.copy(
                card = open.guidance,
                event = open.event,
                alreadyOpen = true,
                phase = EmergencyPhase.Raised,
            )
            return
        }

        runCatching { api.guidance() }.getOrNull()?.let {
            _state.value = _state.value.copy(card = it)
        }
    }

    /** First press. */
    fun arm() {
        val phase = _state.value.phase
        if (phase != EmergencyPhase.Idle && phase !is EmergencyPhase.Failed) return

        armedAt = now()
        _state.value = _state.value.copy(phase = EmergencyPhase.Armed)
    }

    /** Backing out — an explicit cancel, or the window closing. */
    fun disarm() {
        if (_state.value.phase != EmergencyPhase.Armed) return

        armedAt = null
        _state.value = _state.value.copy(phase = EmergencyPhase.Idle)
    }

    /**
     * Second press.
     *
     * Silently does nothing when the button was never armed, or when the window
     * has closed. Both are the same thing from the patient's side: the screen
     * has gone back to showing one button, and pressing it arms again.
     */
    suspend fun confirm(): Boolean {
        if (_state.value.phase != EmergencyPhase.Armed) return false

        val armed = armedAt ?: return false

        if (now() - armed >= armedWindowMillis) {
            disarm()
            return false
        }

        // A second confirm while the first is still in flight would raise a
        // second alarm. The server refuses to open one, but the round trip is
        // wasted and the UI flickers between two responses.
        if (!sending.tryLock()) return false

        _state.value = _state.value.copy(phase = EmergencyPhase.Sending)

        try {
            val location = locationWithinTimeout()
            val view = api.trigger(location?.latitude, location?.longitude)

            _state.value = _state.value.copy(
                event = view.event,
                card = view.guidance,
                alreadyOpen = view.alreadyOpen,
                phase = EmergencyPhase.Raised,
            )

            return true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(phase = EmergencyPhase.Failed(describe(error)))
            return false
        } finally {
            armedAt = null
            sending.unlock()
        }
    }

    /** "I pressed it by accident", while nobody has picked it up yet. */
    suspend fun cancel(): Boolean {
        val event = _state.value.event ?: return false
        if (event.status != EmergencyStatus.TRIGGERED) return false

        return try {
            val cancelled = api.cancel(event.id)
            _state.value = _state.value.copy(
                event = cancelled,
                phase = EmergencyPhase.Idle,
                alreadyOpen = false,
            )
            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(phase = EmergencyPhase.Failed(describe(error)))
            false
        }
    }

    /** Polled while the alarm is open, so the patient sees somebody picked up. */
    suspend fun refresh() {
        val view = runCatching { api.active() }.getOrNull() ?: return

        _state.value = _state.value.copy(event = view.event, card = view.guidance)
    }

    /**
     * Whatever the device knows by the deadline.
     *
     * Losing the race is not an error and is not reported as one — a pin is a
     * convenience, and waiting for one would spend the alarm's first seconds
     * on it.
     */
    private suspend fun locationWithinTimeout(): Coordinates? {
        val source = locator ?: return null

        return try {
            withTimeout(locationTimeoutMillis) { source.currentLocation() }
        } catch (_: TimeoutCancellationException) {
            null
        } catch (_: Throwable) {
            null
        }
    }

    private fun describe(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
