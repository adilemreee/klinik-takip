package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
enum class NotificationChannel {
    PUSH,
    SMS,
    EMAIL,
    WHATSAPP,
    IN_APP,
    ;

    val stringKey: String get() = "notification_channel_${name.lowercase()}"
}

@Serializable
enum class NotificationDeliveryStatus {
    PENDING,
    SENT,
    DELIVERED,
    READ,
    FAILED,
    ;

    val stringKey: String get() = "notification_status_${name.lowercase()}"
}

/** The notification types a person can turn on or off, mirroring the server. */
enum class NotificationKind(val wire: String) {
    LAB_READY("lab.ready"),
    LAB_CRITICAL("lab.critical"),
    NEW_MESSAGE("message.new"),
    MEDICATION_DUE("medication.due"),
    APPOINTMENT_REMINDER("appointment.reminder"),
    DOCUMENT_MISSING("document.missing"),
    COMPLICATION_ANSWERED("complication.answered"),
    ;

    val stringKey: String get() = "notification_type_${wire.replace('.', '_')}"
}

@Serializable
data class NotificationPreference(
    val type: String,
    val channel: NotificationChannel,
    val enabled: Boolean,
    val quietHoursStart: String? = null,
    val quietHoursEnd: String? = null,
    val timezone: String = "Europe/Istanbul",
)

@Serializable
data class DeliveredNotification(
    val id: String,
    val type: String,
    val title: String,
    val body: String,
    val channel: NotificationChannel,
    val status: NotificationDeliveryStatus,
    /** Why this attempt did not arrive. */
    val failureReason: String? = null,
    /** The attempt this one is standing in for. */
    val fallbackForId: String? = null,
    val sentAt: String? = null,
    val readAt: String? = null,
    val createdAt: String,
) {
    val isFallback: Boolean get() = fallbackForId != null
}

@Serializable
private data class TokenBody(
    val token: String,
    val platform: String,
    val deviceId: String? = null,
)

@Serializable
private data class PreferenceBody(
    val type: String,
    val channel: NotificationChannel,
    val enabled: Boolean,
    val quietHoursStart: String? = null,
    val quietHoursEnd: String? = null,
)

@Serializable
private data class MarkedNotificationsRead(val marked: Int)

class NotificationsApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /**
     * Registers this device. Called after the system grants permission, and
     * again whenever the platform hands out a new token.
     */
    suspend fun registerToken(token: String, platform: String = "android", deviceId: String? = null) {
        client.send(
            Endpoint(
                HttpMethod.POST,
                "me/notifications/tokens",
                body = json.encodeToString(
                    TokenBody.serializer(),
                    TokenBody(token, platform, deviceId),
                ),
            ),
        )
    }

    /** Called on sign-out, so a device stops receiving what it may no longer see. */
    suspend fun revokeToken(token: String) {
        client.send(
            Endpoint(
                HttpMethod.DELETE,
                "me/notifications/tokens",
                query = mapOf("token" to token),
            ),
        )
    }

    suspend fun preferences(): List<NotificationPreference> =
        decode(client.send(Endpoint(HttpMethod.GET, "me/notifications/preferences")))

    suspend fun setPreference(
        type: NotificationKind,
        channel: NotificationChannel,
        enabled: Boolean,
        quietHoursStart: String? = null,
        quietHoursEnd: String? = null,
    ): NotificationPreference =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.PUT,
                    "me/notifications/preferences",
                    body = json.encodeToString(
                        PreferenceBody.serializer(),
                        PreferenceBody(type.wire, channel, enabled, quietHoursStart, quietHoursEnd),
                    ),
                ),
            ),
        )

    suspend fun history(): List<DeliveredNotification> =
        decode(client.send(Endpoint(HttpMethod.GET, "me/notifications")))

    suspend fun markRead(): Int =
        decode<MarkedNotificationsRead>(
            client.send(Endpoint(HttpMethod.POST, "me/notifications/read")),
        ).marked

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
