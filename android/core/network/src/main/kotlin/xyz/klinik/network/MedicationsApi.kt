package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
enum class MedicationSource {
    PRESCRIBED,

    /** Added by the patient. Inert until a clinician approves it. */
    PATIENT_REPORTED,
}

@Serializable
enum class DoseStatus {
    PENDING,
    TAKEN,
    SKIPPED,

    /** Taken, but well after its time. Still counts. */
    LATE,
    SNOOZED,
    ;

    val stringKey: String get() = "medication_status_${name.lowercase()}"

    /** Whether the patient still has something to do about this dose. */
    val isOpen: Boolean get() = this == PENDING || this == SNOOZED
}

@Serializable
data class Medication(
    val id: String,
    val patientId: String,
    val drugName: String,
    val dose: String,
    val form: String? = null,
    val frequencyRule: String,
    /** The wall clock the doses belong to — the patient's, not the clinic's. */
    val timezone: String = "Europe/Istanbul",
    val startDate: String,
    val endDate: String? = null,
    val instructions: String? = null,
    val source: MedicationSource = MedicationSource.PRESCRIBED,
    /** Null while a patient-reported medication is waiting for a clinician. */
    val approvedAt: String? = null,
    val stoppedAt: String? = null,
) {
    val isActive: Boolean get() = stoppedAt == null && approvedAt != null
    val awaitingApproval: Boolean get() = approvedAt == null && stoppedAt == null
}

@Serializable
data class Adherence(
    /** 0–1 over the doses that have come due. Null before any have. */
    val score: Double? = null,
    val taken: Int = 0,
    val missed: Int = 0,
    val due: Int = 0,
    val upcoming: Int = 0,
    val streak: Int = 0,
) {
    /** A whole-number percentage, or null when there is nothing to report yet. */
    val percentage: Int? get() = score?.let { Math.round(it * 100).toInt() }

    /**
     * Whether to show the score at all.
     *
     * A course with nothing due yet has no score, and rendering that as nought
     * per cent would tell a patient on their first morning that they are
     * failing.
     */
    val hasScore: Boolean get() = score != null
}

@Serializable
data class DoseLog(
    val id: String,
    val medicationId: String,
    val scheduledAt: String,
    val takenAt: String? = null,
    val status: DoseStatus = DoseStatus.PENDING,
    val snoozedUntil: String? = null,
)

@Serializable
data class MedicationView(
    val medication: Medication,
    /** The rule in a sentence, so a clinician can check what they wrote. */
    val schedule: String,
    val adherence: Adherence = Adherence(),
    val badges: List<String> = emptyList(),
    val nextDose: String? = null,
)

@Serializable
data class MyMedications(
    val medications: List<MedicationView> = emptyList(),
    /** Today's doses, in order, for the check-in screen. */
    val today: List<DoseLog> = emptyList(),
    val overall: Adherence = Adherence(),
    /** Withheld while a course is going badly — the tone rule from M9. */
    val badges: List<String> = emptyList(),
) {
    fun badgeKeys(): List<String> = badges.map { "medication_badge_${it.replace('-', '_')}" }

    /** Doses still waiting on the patient right now. */
    val openToday: List<DoseLog> get() = today.filter { it.status.isOpen }
}

@Serializable
private data class DoseCheckInBody(val action: String, val snoozeMinutes: Int? = null)

@Serializable
private data class ReportMedicationBody(
    val drugName: String,
    val dose: String,
    val frequencyRule: String,
    val startDate: String,
)

class MedicationsApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    suspend fun mine(): MyMedications = decode(client.send(Endpoint(HttpMethod.GET, "me/medications")))

    suspend fun forPatient(patientId: String): List<MedicationView> =
        decode(client.send(Endpoint(HttpMethod.GET, "patients/$patientId/medications")))

    /** "İçtim" / "Atladım" / "Ertele". */
    suspend fun checkIn(logId: String, action: String, snoozeMinutes: Int? = null): DoseLog =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.PATCH,
                    "me/medications/doses/$logId",
                    body = json.encodeToString(
                        DoseCheckInBody.serializer(),
                        DoseCheckInBody(action, snoozeMinutes),
                    ),
                ),
            ),
        )

    /** Something the patient is already taking; a clinician approves it. */
    suspend fun report(
        drugName: String,
        dose: String,
        frequencyRule: String,
        startDate: String,
    ): MedicationView =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "me/medications",
                    body = json.encodeToString(
                        ReportMedicationBody.serializer(),
                        ReportMedicationBody(drugName, dose, frequencyRule, startDate),
                    ),
                ),
            ),
        )

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
