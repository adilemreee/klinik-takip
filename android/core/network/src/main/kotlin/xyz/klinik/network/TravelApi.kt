package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Getting the patient here and home again (spec M14).
 *
 * A health-tourism clinic's file is half clinical and half logistical: a
 * flight, a hotel, somebody meeting them at the airport, an interpreter. None
 * of it is medical, and one field on it is: `clearedToFlyAt` is set by a
 * clinician and never computed from the surgery date, because "seven days
 * after an operation" is a rule of thumb and a signature is a decision.
 */
@Serializable
data class TravelPlan(
    val id: String,
    val patientId: String,
    val arrivalFlight: String? = null,
    val arrivalAt: String? = null,
    val departureFlight: String? = null,
    val departureAt: String? = null,
    val hotelName: String? = null,
    val hotelAddress: String? = null,
    val hotelCheckIn: String? = null,
    val hotelCheckOut: String? = null,
    val greeterName: String? = null,
    val greeterPhone: String? = null,
    val transferNote: String? = null,
    val interpreterName: String? = null,
    val interpreterLanguage: String? = null,
    val interpreterPhone: String? = null,
    /** Set by a clinician; never computed from the surgery date. */
    val clearedToFlyAt: String? = null,
    val notes: String? = null,
    /** Sent back on a save, so two coordinators cannot overwrite each other. */
    val version: Int = 0,
) {
    val isClearedToFly: Boolean get() = clearedToFlyAt != null

    /** Whether anybody has filled any of it in. */
    val isEmpty: Boolean
        get() = listOf(
            arrivalFlight, arrivalAt, departureFlight, departureAt,
            hotelName, greeterName, interpreterName, notes,
        ).all { it.isNullOrBlank() }
}

@Serializable
data class TravelPlanView(
    val plan: TravelPlan? = null,
    /** Who signed off the flight. Null when nobody has. */
    val clearedToFlyBy: String? = null,
)

@Serializable
data class UpsertTravelPlan(
    val arrivalFlight: String? = null,
    val arrivalAt: String? = null,
    val departureFlight: String? = null,
    val departureAt: String? = null,
    val hotelName: String? = null,
    val hotelAddress: String? = null,
    val hotelCheckIn: String? = null,
    val hotelCheckOut: String? = null,
    val greeterName: String? = null,
    val greeterPhone: String? = null,
    val transferNote: String? = null,
    val interpreterName: String? = null,
    val interpreterLanguage: String? = null,
    val interpreterPhone: String? = null,
    val notes: String? = null,
    /**
     * What the editor last read.
     *
     * Two coordinators arranging one patient's travel is the ordinary case in
     * this clinic, and the second save winning silently would lose the first's
     * flight number.
     */
    val expectedVersion: Int? = null,
)

@Serializable
private data class ClearToFlyBody(val cleared: Boolean)

class TravelApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /** The patient's own copy. Read-only: they do not arrange their own transfer. */
    suspend fun mine(): TravelPlanView =
        decode(client.send(Endpoint(HttpMethod.GET, "me/travel")))

    suspend fun forPatient(patientId: String): TravelPlanView =
        decode(client.send(Endpoint(HttpMethod.GET, "patients/$patientId/travel")))

    suspend fun save(patientId: String, plan: UpsertTravelPlan): TravelPlanView =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.PUT,
                    "patients/$patientId/travel",
                    body = json.encodeToString(UpsertTravelPlan.serializer(), plan),
                ),
            ),
        )

    /**
     * A clinician's signature on the flight home.
     *
     * Separate from the rest of the plan on purpose: everything else on this
     * screen is logistics a coordinator owns, and this one is a medical
     * decision with a name against it.
     */
    suspend fun setClearedToFly(patientId: String, cleared: Boolean): TravelPlanView =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.PATCH,
                    "patients/$patientId/travel/cleared-to-fly",
                    body = json.encodeToString(ClearToFlyBody.serializer(), ClearToFlyBody(cleared)),
                ),
            ),
        )

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
