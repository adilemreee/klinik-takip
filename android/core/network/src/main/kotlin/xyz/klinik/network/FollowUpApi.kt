package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
enum class MilestoneStatus {
    PENDING,
    NOTIFIED,
    COMPLETED,
    MISSED,
    SKIPPED,
    ;

    val stringKey: String get() = "followup_status_${name.lowercase()}"

    /** Whether the clinic is still waiting for this visit to happen. */
    val isOutstanding: Boolean get() = this == PENDING || this == NOTIFIED || this == MISSED
}

@Serializable
data class Milestone(
    val id: String,
    /** D1, W1, M1… — the same labels the photo gallery uses for its phases. */
    val label: String,
    val dueAt: String,
    val status: MilestoneStatus = MilestoneStatus.PENDING,
    val notifiedAt: String? = null,
    val completedAt: String? = null,
) {
    val stringKey: String get() = "followup_milestone_${label.lowercase()}"
}

@Serializable
data class FollowUpSchedule(
    val id: String,
    val patientId: String,
    val surgeryDate: String,
    val template: String? = null,
    /** Soonest first. */
    val milestones: List<Milestone> = emptyList(),
) {
    /**
     * The next visit still ahead, which is what a patient opens this for.
     *
     * Compared as ISO-8601 strings, which sort chronologically when they are
     * all UTC — and the server always sends UTC. Parsing would need a date
     * library in a module that has none, for an ordering the format already
     * gives.
     */
    fun next(nowIso: String): Milestone? =
        milestones.firstOrNull { it.dueAt >= nowIso && it.status.isOutstanding }

    val missed: List<Milestone> get() = milestones.filter { it.status == MilestoneStatus.MISSED }
}

@Serializable
private data class GenerateBody(
    val surgeryDate: String,
    val template: String? = null,
    val timezone: String? = null,
)

@Serializable
private data class StatusBody(val status: MilestoneStatus)

class FollowUpApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /** Null when no schedule has been generated: the endpoint answers `{}`. */
    suspend fun mine(): FollowUpSchedule? =
        optional(client.send(Endpoint(HttpMethod.GET, "me/follow-up")))

    suspend fun forPatient(patientId: String): FollowUpSchedule? =
        optional(client.send(Endpoint(HttpMethod.GET, "patients/$patientId/follow-up")))

    suspend fun generate(
        patientId: String,
        surgeryDate: String,
        template: String? = null,
        timezone: String? = null,
    ): FollowUpSchedule =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "patients/$patientId/follow-up",
                    body = json.encodeToString(
                        GenerateBody.serializer(),
                        GenerateBody(surgeryDate, template, timezone),
                    ),
                ),
            ),
        )

    suspend fun setStatus(milestoneId: String, status: MilestoneStatus): Milestone =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.PATCH,
                    "follow-up/milestones/$milestoneId",
                    body = json.encodeToString(StatusBody.serializer(), StatusBody(status)),
                ),
            ),
        )

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }

    private fun optional(body: String): FollowUpSchedule? =
        runCatching { json.decodeFromString<FollowUpSchedule>(body) }.getOrNull()
}
