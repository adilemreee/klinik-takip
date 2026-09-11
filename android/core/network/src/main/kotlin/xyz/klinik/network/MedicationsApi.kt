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

    val stringKey: String get() = "medication.status.$name"

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
enum class InteractionSeverity {
    CONTRAINDICATED,
    MAJOR,
    MODERATE,
    MINOR,
    ;

    val stringKey: String get() = "interaction.severity.$name"

    /**
     * Whether this one has to interrupt.
     *
     * Everything is shown; interrupting on a minor interaction is how a clinic
     * learns to dismiss the dialog without reading it.
     */
    val isSevere: Boolean get() = this == CONTRAINDICATED || this == MAJOR
}

@Serializable
data class InteractingDrug(
    val id: String,
    /** As it was written. */
    val drugName: String,
)

@Serializable
data class InteractionWarning(
    val severity: InteractionSeverity,
    val note: String,
    val ingredients: List<String> = emptyList(),
    /** The two medications, in the clinician's own words. */
    val between: List<InteractingDrug> = emptyList(),
)

@Serializable
data class InteractionCheck(
    /** Most serious first. */
    val warnings: List<InteractionWarning> = emptyList(),
    /**
     * Drugs the reference did not recognise.
     *
     * The screen must show this. An empty warning list next to three
     * unrecognised drugs is not a clean bill of health, and reading it as one is
     * how software misleads somebody.
     */
    val unrecognised: List<InteractingDrug> = emptyList(),
    /** Zero means nothing was actually compared. */
    val comparedPairs: Int = 0,
) {
    /** Whether the answer says anything at all about safety. */
    val checkedAnything: Boolean get() = comparedPairs > 0
    val hasSevere: Boolean get() = warnings.any { it.severity.isSevere }
}

@Serializable
data class MedicationView(
    val medication: Medication,
    /** The rule in a sentence, so a clinician can check what they wrote. */
    val schedule: String,
    val adherence: Adherence = Adherence(),
    val badges: List<String> = emptyList(),
    val nextDose: String? = null,
    /** Present when a clinician has just written or approved a prescription. */
    val interactions: InteractionCheck? = null,
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
    fun badgeKeys(): List<String> = badges.map { "medication.badge.$it" }

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

/**
 * A prescription, as the clinician wrote it.
 *
 * `frequencyRule` is an RFC 5545 RRULE and the server refuses anything it does
 * not support rather than guessing — a dose schedule guessed at is a patient
 * taking a drug at the wrong hour. `timezone` travels with it because a dose
 * is a wall-clock event: "nine in the morning" means the patient's morning,
 * not the clinic's.
 */
@Serializable
data class Prescription(
    val drugName: String,
    val dose: String,
    val form: String? = null,
    val frequencyRule: String,
    val startDate: String,
    val endDate: String? = null,
    /** Wall-clock time of the first dose, e.g. `09:00`. */
    val startTime: String? = null,
    val timezone: String? = null,
    val instructions: String? = null,
)

class MedicationsApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    suspend fun mine(): MyMedications = decode(client.send(Endpoint(HttpMethod.GET, "me/medications")))

    suspend fun forPatient(patientId: String): List<MedicationView> =
        decode(client.send(Endpoint(HttpMethod.GET, "patients/$patientId/medications")))

    /** What the reference knows about the drugs this patient is on. */
    suspend fun interactions(patientId: String): InteractionCheck =
        decode(client.send(Endpoint(HttpMethod.GET, "patients/$patientId/medications/interactions")))

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

    /** A clinician writing a plan. The patient ticks the doses off. */
    suspend fun prescribe(patientId: String, prescription: Prescription): MedicationView =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "patients/$patientId/medications",
                    body = json.encodeToString(Prescription.serializer(), prescription),
                ),
            ),
        )

    /**
     * Approves something the patient said they were already taking.
     *
     * Until this, the entry is inert: no doses are generated and nothing is
     * counted against adherence. A clinic that treated a patient's word as a
     * prescription would be prescribing by proxy.
     */
    suspend fun approve(medicationId: String): MedicationView =
        decode(client.send(Endpoint(HttpMethod.PATCH, "medications/$medicationId/approve")))

    /** Stops a course. The record stays; the schedule ends. */
    suspend fun stop(medicationId: String): MedicationView =
        decode(client.send(Endpoint(HttpMethod.PATCH, "medications/$medicationId/stop")))

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
