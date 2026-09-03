package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
enum class EmergencyStatus {
    TRIGGERED,
    ACKNOWLEDGED,
    RESOLVED,
    FALSE_ALARM,
    ;

    val stringKey: String get() = "emergency_status_${name.lowercase()}"

    /** Whether the clinic is still working on it. */
    val isOpen: Boolean get() = this == TRIGGERED || this == ACKNOWLEDGED
}

@Serializable
data class EmergencyEvent(
    val id: String,
    val patientId: String,
    val status: EmergencyStatus,
    val triggeredAt: String,
    val latitude: String? = null,
    val longitude: String? = null,
    val note: String? = null,
    /** 0 immediately, 1 at two minutes, 2 at five. */
    val escalationLevel: Int = 0,
    val acknowledgedAt: String? = null,
    val resolution: String? = null,
    val resolvedAt: String? = null,
)

@Serializable
data class EmergencyNumber(
    val number: String,
    val countryCode: String,
    /** `country` when the server knew it, `international` when it guessed. */
    val source: String,
) {
    /** A guessed number needs the caveat next to it; a known one does not. */
    val isGuess: Boolean get() = source != "country"

    /** What a dial intent accepts. */
    val dialUri: String get() = "tel:$number"
}

@Serializable
data class GuidanceStep(
    val id: String,
    val text: String,
    /** The one line that points away from the clinic, rendered larger. */
    val critical: Boolean = false,
)

@Serializable
data class EmergencyGuidance(
    val language: String,
    val emergencyNumber: EmergencyNumber,
    val steps: List<GuidanceStep> = emptyList(),
) {
    val criticalStep: GuidanceStep? get() = steps.firstOrNull { it.critical }
    val ordinarySteps: List<GuidanceStep> get() = steps.filterNot { it.critical }
}

@Serializable
data class PatientEmergencyView(
    val event: EmergencyEvent,
    val guidance: EmergencyGuidance,
    /** The button was pressed on a call that was already open. */
    val alreadyOpen: Boolean = false,
)

@Serializable
data class LastSurgery(
    val procedureName: String,
    val performedAt: String,
    val daysAgo: Int,
)

@Serializable
data class EmergencySummary(
    val patientId: String,
    val mrn: String,
    val fullName: String,
    val age: Int? = null,
    val sex: String,
    val country: String,
    val city: String? = null,
    val phone: String? = null,
    val preferredLanguage: String = "tr",
    val bloodType: String? = null,
    val allergies: List<String> = emptyList(),
    val chronicConditions: List<String> = emptyList(),
    val currentMedications: List<String> = emptyList(),
    val lastSurgery: LastSurgery? = null,
    val assignedDoctor: String? = null,
)

@Serializable
data class StaffEmergencyView(
    val event: EmergencyEvent,
    val summary: EmergencySummary,
    val waitingMinutes: Int = 0,
    val responseMinutes: Int? = null,
    /** The escalation ladder ran out and nobody has answered. */
    val unanswered: Boolean = false,
)

@Serializable
private data class TriggerBody(
    val latitude: Double? = null,
    val longitude: Double? = null,
    val note: String? = null,
)

@Serializable
private data class ResolveBody(val resolution: String, val falseAlarm: Boolean = false)

class EmergencyApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /**
     * The button.
     *
     * Location is passed when the device has one and omitted when it does not.
     * It is never waited for: a fix can take fifteen seconds on a cold start,
     * and the alarm is worth more than the pin.
     */
    suspend fun trigger(
        latitude: Double? = null,
        longitude: Double? = null,
        note: String? = null,
    ): PatientEmergencyView =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "me/emergency",
                    body = json.encodeToString(
                        TriggerBody.serializer(),
                        TriggerBody(latitude, longitude, note),
                    ),
                ),
            ),
        )

    /** Fetched ahead of time so the card is already on the device when it is needed. */
    suspend fun guidance(): EmergencyGuidance =
        decode(client.send(Endpoint(HttpMethod.GET, "me/emergency/guidance")))

    suspend fun active(): PatientEmergencyView? {
        val body = client.send(Endpoint(HttpMethod.GET, "me/emergency/active"))

        // An empty body and a literal `null` both mean "nothing open"; neither
        // is an error, and decoding either as one would put a red screen in
        // front of a patient who has no emergency.
        if (body.isBlank() || body.trim() == "null") return null

        return decode(body)
    }

    suspend fun cancel(emergencyId: String): EmergencyEvent =
        decode(client.send(Endpoint(HttpMethod.PATCH, "me/emergency/$emergencyId/cancel")))

    suspend fun queue(includeClosed: Boolean = false): List<StaffEmergencyView> =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.GET,
                    "emergency",
                    query = if (includeClosed) mapOf("includeClosed" to "true") else emptyMap(),
                ),
            ),
        )

    suspend fun detail(emergencyId: String): StaffEmergencyView =
        decode(client.send(Endpoint(HttpMethod.GET, "emergency/$emergencyId")))

    suspend fun acknowledge(emergencyId: String): StaffEmergencyView =
        decode(client.send(Endpoint(HttpMethod.PATCH, "emergency/$emergencyId/acknowledge")))

    suspend fun resolve(
        emergencyId: String,
        resolution: String,
        falseAlarm: Boolean = false,
    ): StaffEmergencyView =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.PATCH,
                    "emergency/$emergencyId/resolve",
                    body = json.encodeToString(
                        ResolveBody.serializer(),
                        ResolveBody(resolution, falseAlarm),
                    ),
                ),
            ),
        )

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
