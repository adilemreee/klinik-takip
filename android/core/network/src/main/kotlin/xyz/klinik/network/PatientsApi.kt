package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class Patient(
    val id: String,
    /** Human-facing file number, e.g. 2026-K7RMPX. */
    val mrn: String,
    val firstName: String,
    val lastName: String,
    val birthDate: String,
    val sex: String,
    val country: String,
    val city: String? = null,
    val preferredLanguage: String,
    val status: String,
    val createdAt: String,
) {
    val fullName: String get() = "$firstName $lastName"
}

@Serializable
data class PatientPage(
    val items: List<Patient>,
    /** Null on the last page. */
    val nextCursor: String? = null,
)

data class PatientSearch(
    val query: String? = null,
    val country: String? = null,
    val status: String? = null,
    val cursor: String? = null,
    val limit: Int? = null,
) {
    fun toQuery(): Map<String, String> = buildMap {
        query?.takeIf { it.isNotEmpty() }?.let { put("q", it) }
        country?.let { put("country", it) }
        status?.let { put("status", it) }
        cursor?.let { put("cursor", it) }
        limit?.let { put("limit", it.toString()) }
    }
}

class PatientsApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    suspend fun search(search: PatientSearch): PatientPage =
        decode(client.send(Endpoint(HttpMethod.GET, "patients", query = search.toQuery())))

    suspend fun detail(id: String): Patient =
        decode(client.send(Endpoint(HttpMethod.GET, "patients/$id")))

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}

// MARK: - Patient-facing

@Serializable
data class NextAppointment(
    val id: String,
    val scheduledAt: String,
    val type: String,
    val location: String? = null,
)

@Serializable
data class HomePatient(
    val id: String,
    val mrn: String,
    val firstName: String,
    val lastName: String,
    val preferredLanguage: String,
    val status: String,
) {
    val fullName: String get() = "$firstName $lastName"
}

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
    suspend fun summary(): PatientHomeSummary =
        runCatching {
            json.decodeFromString<PatientHomeSummary>(
                client.send(Endpoint(HttpMethod.GET, "me/summary")),
            )
        }.getOrElse {
            if (it is ApiError) throw it
            throw ApiError.Decoding(it.message ?: "unreadable response")
        }
}
