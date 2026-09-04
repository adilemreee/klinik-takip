package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Who is signed in (spec section 2).
 *
 * The app's first question once a token exists, and deliberately a server call
 * rather than a decode of the access token: the role decides what a person is
 * shown, and reading it out of a JWT in the client puts that decision somewhere
 * that cannot be verified and cannot be revoked.
 */

@Serializable
enum class UserRole {
    SUPER_ADMIN,
    DOCTOR,
    NURSE,
    COORDINATOR,
    FINANCE,
    PATIENT,
    CAREGIVER,
    ;

    /**
     * This role's key in the shared string catalogue, e.g. `role.DOCTOR`.
     *
     * Dotted and upper-cased because the catalogue is the iOS one and both
     * clients read the same keys; Android's own resource name (`role_doctor`)
     * is derived from it by the generator, not written by hand.
     */
    val stringKey: String get() = "role.$name"
}

@Serializable
data class Identity(
    val userId: String,
    val role: UserRole,
    /** For the greeting. Never blank — a nameless greeting looks broken. */
    val displayName: String,
    /**
     * The patient file this account *is*. Null for staff, and null for a
     * patient whose file has not been linked yet.
     */
    val patientId: String? = null,
    val isStaff: Boolean = false,
)

/** Everything the patient home screen needs, in one call. */
@Serializable
data class PatientHomeSummary(
    val patient: HomePatient,
    val nextAppointment: NextAppointment? = null,
    /** Doses scheduled for today that are still waiting. */
    val medicationsDueToday: Int,
    val unreadMessages: Int,
    /** Mandatory pre-op documents not yet uploaded (spec M17). */
    val missingDocuments: Int,
)

class MeApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /** Who is signed in. The app's first call once a token exists. */
    suspend fun identity(): Identity =
        decode<Identity>(client.send(Endpoint(HttpMethod.GET, "me/identity")))

    suspend fun summary(): PatientHomeSummary =
        decode<PatientHomeSummary>(client.send(Endpoint(HttpMethod.GET, "me/summary")))

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse {
                if (it is ApiError) throw it
                throw ApiError.Decoding(it.message ?: "unreadable response")
            }
}
