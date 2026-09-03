package xyz.klinik.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** What a clinician should look at first, and why. */
@Serializable
enum class RiskKind {
    @SerialName("emergency-unanswered")
    EMERGENCY_UNANSWERED,

    @SerialName("message-urgent")
    MESSAGE_URGENT,

    @SerialName("complication-overdue")
    COMPLICATION_OVERDUE,

    @SerialName("follow-up-missed")
    FOLLOW_UP_MISSED,

    @SerialName("report-unreviewed")
    REPORT_UNREVIEWED,
    ;

    val stringKey: String get() = "briefing_risk_${name.lowercase()}"
}

@Serializable
data class RiskItem(
    val patientId: String,
    val patientName: String,
    val kind: RiskKind,
    /** What is waiting. Never the patient's own words. */
    val detail: String,
    val waitingMinutes: Int = 0,
) {
    /** Minutes for the first hour, then hours — a doctor does not read "4,320". */
    val waitingHours: Int get() = waitingMinutes / 60
    val showsHours: Boolean get() = waitingMinutes >= 60
}

@Serializable
data class BriefingYesterday(
    val newMessages: Int = 0,
    val urgentMessages: Int = 0,
    val emergencies: Int = 0,
    val complications: Int = 0,
    val criticalLabs: Int = 0,
)

@Serializable
data class BriefingToday(
    val appointments: Int = 0,
    val followUps: Int = 0,
)

@Serializable
data class BriefingFacts(
    val generatedAt: String,
    val yesterday: BriefingYesterday = BriefingYesterday(),
    val today: BriefingToday = BriefingToday(),
    /** Emergencies first, then longest waiting. */
    val atRisk: List<RiskItem> = emptyList(),
)

@Serializable
data class Briefing(
    /** Always present. The briefing is data. */
    val facts: BriefingFacts,
    /** A paragraph over the numbers, when the AI layer wrote one. */
    val narrative: String? = null,
    val quiet: Boolean = false,
) {
    /**
     * Whether the screen has anything to show.
     *
     * Deliberately reads the facts rather than the narrative: a briefing with no
     * paragraph is still a briefing, and rendering the screen off the prose
     * would make a switched-off AI layer look like an empty morning.
     */
    val hasContent: Boolean get() = !quiet
}

class BriefingApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /** Scoped to the caller's own patients, like every other clinical read. */
    suspend fun mine(): Briefing =
        runCatching { json.decodeFromString<Briefing>(client.send(Endpoint(HttpMethod.GET, "me/briefing"))) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
