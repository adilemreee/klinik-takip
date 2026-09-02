package xyz.klinik.feature.notifications

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import xyz.klinik.network.ApiError
import xyz.klinik.network.DeliveredNotification
import xyz.klinik.network.NotificationChannel
import xyz.klinik.network.NotificationKind
import xyz.klinik.network.NotificationPreference
import xyz.klinik.network.NotificationsApi
import xyz.klinik.network.UiText
import xyz.klinik.network.messageKey
import xyz.klinik.network.uiText

sealed interface SettingsPhase {
    data object Loading : SettingsPhase
    data object Loaded : SettingsPhase
    data class Failed(val messageKey: String) : SettingsPhase
}

data class NotificationSettingsState(
    val phase: SettingsPhase = SettingsPhase.Loading,
    val preferences: List<NotificationPreference> = emptyList(),
    val history: List<DeliveredNotification> = emptyList(),
    /** The row being saved, so its switch can be disabled. */
    val saving: String? = null,
    val error: UiText? = null,
) {
    /**
     * Whether a type is on for a channel.
     *
     * Absent means on: someone who never opened this screen still gets told
     * their results are ready. Only a stored `false` silences anything, which
     * is the same rule the server applies — if the two disagreed, the switch
     * would show one thing and the clinic would do another.
     */
    fun isEnabled(type: NotificationKind, channel: NotificationChannel): Boolean =
        preferences.firstOrNull { it.type == type.wire && it.channel == channel }?.enabled ?: true

    fun quietHours(type: NotificationKind): Pair<String, String>? {
        val match = preferences.firstOrNull {
            it.type == type.wire && it.channel == NotificationChannel.PUSH
        } ?: return null

        val start = match.quietHoursStart ?: return null
        val end = match.quietHoursEnd ?: return null

        return start to end
    }
}

/** The notification preferences screen (spec M6). */
class NotificationSettingsModel(private val api: NotificationsApi) {
    private val _state = MutableStateFlow(NotificationSettingsState())
    val state: StateFlow<NotificationSettingsState> = _state.asStateFlow()

    private val saveLock = Mutex()

    suspend fun load() {
        _state.value = _state.value.copy(phase = SettingsPhase.Loading)

        try {
            coroutineScope {
                val preferences = async { api.preferences() }
                val history = async { api.history() }

                _state.value = _state.value.copy(
                    preferences = preferences.await(),
                    history = history.await(),
                    phase = SettingsPhase.Loaded,
                )
            }
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                phase = SettingsPhase.Failed(
                    (error as? ApiError)?.messageKey() ?: "error.server",
                ),
            )
        }
    }

    /**
     * Turns a type on or off for a channel.
     *
     * The saved row replaces the local one rather than the switch keeping its
     * own idea of the answer: a switch that stays flipped after the server
     * refused is a setting the person believes they made.
     */
    suspend fun set(
        type: NotificationKind,
        channel: NotificationChannel,
        enabled: Boolean,
    ): Boolean {
        val quiet = _state.value.quietHours(type)

        return save("${type.wire}|${channel.name}") {
            api.setPreference(type, channel, enabled, quiet?.first, quiet?.second)
        }
    }

    suspend fun setQuietHours(type: NotificationKind, start: String?, end: String?): Boolean =
        save(type.wire) {
            api.setPreference(
                type,
                NotificationChannel.PUSH,
                _state.value.isEnabled(type, NotificationChannel.PUSH),
                start,
                end,
            )
        }

    /** Registers this device once the system has granted permission. */
    suspend fun registerDevice(token: String, deviceId: String? = null) {
        runCatching { api.registerToken(token, deviceId = deviceId) }
    }

    /** On sign-out: the device stops receiving what it may no longer see. */
    suspend fun forgetDevice(token: String) {
        runCatching { api.revokeToken(token) }
    }

    suspend fun markHistoryRead() {
        runCatching { api.markRead() }
    }

    private suspend fun save(
        key: String,
        work: suspend () -> NotificationPreference,
    ): Boolean {
        if (!saveLock.tryLock()) return false

        _state.value = _state.value.copy(saving = key, error = null)

        val saved = try {
            work()
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                saving = null,
                error = (error as? ApiError)?.uiText() ?: UiText.Key("error.server"),
            )
            return false
        } finally {
            saveLock.unlock()
        }

        val existing = _state.value.preferences.indexOfFirst {
            it.type == saved.type && it.channel == saved.channel
        }

        val preferences = if (existing >= 0) {
            _state.value.preferences.toMutableList().also { it[existing] = saved }
        } else {
            _state.value.preferences + saved
        }

        _state.value = _state.value.copy(preferences = preferences, saving = null)
        return true
    }
}
