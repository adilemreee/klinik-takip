package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

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

/**
 * Everything the clinic holds about one patient, as a file they can keep.
 *
 * The counts are what a screen shows; the sections themselves are opaque here
 * on purpose. This is a portability file — its shape is the server's promise
 * to the patient, and a client that re-modelled every row would quietly drop
 * whatever it did not recognise from a document meant to be complete.
 */
@Serializable
data class DataExport(
    val exportedAt: String,
    /** Format identifier, e.g. `klinik-portability-1`. */
    val format: String,
    val patient: JsonElement,
    val medicalProfile: JsonElement? = null,
    val measurements: List<JsonElement> = emptyList(),
    val documents: List<JsonElement> = emptyList(),
    /** Confirmed results only; an unreviewed OCR reading is not a lab result. */
    val labResults: List<JsonElement> = emptyList(),
    val photos: List<JsonElement> = emptyList(),
    val appointments: List<JsonElement> = emptyList(),
    val medications: List<JsonElement> = emptyList(),
    val complications: List<JsonElement> = emptyList(),
    val consents: List<JsonElement> = emptyList(),
    val surveyResponses: List<JsonElement> = emptyList(),
    /**
     * What this file deliberately leaves out.
     *
     * Shown, never hidden: a portability file with silent gaps is worse than
     * one that names them, because the patient believes they have everything.
     */
    val notIncluded: List<String> = emptyList(),
) {
    /** Section name to row count, in the order the file lists them. */
    val sectionCounts: List<Pair<String, Int>>
        get() = listOf(
            "measurements" to measurements.size,
            "documents" to documents.size,
            "labResults" to labResults.size,
            "photos" to photos.size,
            "appointments" to appointments.size,
            "medications" to medications.size,
            "complications" to complications.size,
            "consents" to consents.size,
            "surveyResponses" to surveyResponses.size,
        )

    val rowCount: Int get() = sectionCounts.sumOf { it.second }
}

class MeApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /** Who is signed in. The app's first call once a token exists. */
    suspend fun identity(): Identity =
        decode<Identity>(client.send(Endpoint(HttpMethod.GET, "me/identity")))

    suspend fun summary(): PatientHomeSummary =
        decode<PatientHomeSummary>(client.send(Endpoint(HttpMethod.GET, "me/summary")))

    /**
     * Everything the clinic holds about this patient, as one file.
     *
     * The whole document comes back in one response, so the caller writes it
     * out rather than paging it: a portability file assembled from pages is a
     * file that can be half-written.
     */
    suspend fun dataExport(): DataExport =
        decode<DataExport>(client.send(Endpoint(HttpMethod.GET, "me/data-export")))

    /** The same document, verbatim, for writing to a file the patient keeps. */
    suspend fun dataExportJson(): String =
        client.send(Endpoint(HttpMethod.GET, "me/data-export"))

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse {
                if (it is ApiError) throw it
                throw ApiError.Decoding(it.message ?: "unreadable response")
            }
}
