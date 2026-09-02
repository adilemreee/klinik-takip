package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
enum class AppointmentType {
    CONSULTATION,
    SURGERY,
    CONTROL,
    VIDEO_CALL,
    ;

    val stringKey: String get() = "appointment_type_${name.lowercase()}"
}

@Serializable
enum class AppointmentStatus {
    /** A patient has asked; the clinic has not agreed yet. */
    REQUESTED,
    CONFIRMED,
    CANCELLED,
    COMPLETED,
    NO_SHOW,
    ;

    val stringKey: String get() = "appointment_status_${name.lowercase()}"

    /** Whether the patient is still expected to come. */
    val isUpcoming: Boolean get() = this == REQUESTED || this == CONFIRMED
}

@Serializable
data class Appointment(
    val id: String,
    val patientId: String,
    val staffId: String? = null,
    val type: AppointmentType,
    val status: AppointmentStatus,
    val scheduledAt: String,
    val durationMinutes: Int = 30,
    val location: String? = null,
    val note: String? = null,
    val cancelledAt: String? = null,
    val cancelledReason: String? = null,
    /** Reminders already sent — P7D, P1D, PT2H. */
    val remindersSent: List<String> = emptyList(),
)

/** A clash the server refused, in a form the screen can explain. */
sealed interface BookingRefusal {
    data object SlotTaken : BookingRefusal
    data object OutsideAvailability : BookingRefusal
    data class Other(val message: String) : BookingRefusal
}

@Serializable
private data class BookBody(
    val type: AppointmentType,
    val scheduledAt: String,
    val staffId: String? = null,
    val note: String? = null,
    val durationMinutes: Int? = null,
    val location: String? = null,
)

@Serializable
private data class RescheduleBody(val scheduledAt: String)

@Serializable
private data class CancelBody(val reason: String? = null)

class AppointmentsApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    suspend fun mine(): List<Appointment> =
        decode(client.send(Endpoint(HttpMethod.GET, "me/appointments")))

    suspend fun forPatient(patientId: String): List<Appointment> =
        decode(client.send(Endpoint(HttpMethod.GET, "patients/$patientId/appointments")))

    suspend fun calendar(from: String, to: String): List<Appointment> =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.GET,
                    "appointments/calendar",
                    query = mapOf("from" to from, "to" to to),
                ),
            ),
        )

    /** A patient asking. The clinic confirms it separately. */
    suspend fun request(
        type: AppointmentType,
        scheduledAt: String,
        staffId: String? = null,
        note: String? = null,
    ): Appointment =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "me/appointments",
                    body = json.encodeToString(
                        BookBody.serializer(),
                        BookBody(type, scheduledAt, staffId, note),
                    ),
                ),
            ),
        )

    suspend fun book(
        patientId: String,
        type: AppointmentType,
        scheduledAt: String,
        staffId: String? = null,
        durationMinutes: Int? = null,
        location: String? = null,
        note: String? = null,
    ): Appointment =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "patients/$patientId/appointments",
                    body = json.encodeToString(
                        BookBody.serializer(),
                        BookBody(type, scheduledAt, staffId, note, durationMinutes, location),
                    ),
                ),
            ),
        )

    suspend fun confirm(appointmentId: String): Appointment =
        decode(client.send(Endpoint(HttpMethod.PATCH, "appointments/$appointmentId/confirm")))

    suspend fun reschedule(appointmentId: String, scheduledAt: String): Appointment =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.PATCH,
                    "appointments/$appointmentId/reschedule",
                    body = json.encodeToString(
                        RescheduleBody.serializer(),
                        RescheduleBody(scheduledAt),
                    ),
                ),
            ),
        )

    suspend fun cancel(appointmentId: String, reason: String? = null): Appointment =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.PATCH,
                    "appointments/$appointmentId/cancel",
                    body = json.encodeToString(CancelBody.serializer(), CancelBody(reason)),
                ),
            ),
        )

    companion object {
        /**
         * Reads a refusal the server sent as a conflict.
         *
         * The two reasons need different words: "that time is taken" sends
         * someone looking for another slot, where "the clinic is not open then"
         * sends them to another day. Telling them the wrong one wastes their
         * afternoon.
         */
        fun refusal(error: ApiError): BookingRefusal? {
            if (error !is ApiError.Conflict) return null

            return when {
                error.body.message.contains("SLOT_TAKEN") -> BookingRefusal.SlotTaken
                error.body.message.contains("OUTSIDE_AVAILABILITY") ->
                    BookingRefusal.OutsideAvailability
                else -> BookingRefusal.Other(error.body.message)
            }
        }
    }

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
