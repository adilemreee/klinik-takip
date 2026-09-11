package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Who did what to whose record (spec M13).
 *
 * The log is the thing that makes the rest of the clinic answerable, so the
 * client's whole job here is to not lose any of it. Nothing is filtered away
 * on this side, an entity type with no translation is shown as the server
 * spelled it, and an anomaly's sentence is the server's own words.
 */

/** What was done. Mirrors the server's enum; the names are the wire form. */
@Serializable
enum class AuditAction {
    CREATE,
    READ,
    UPDATE,
    DELETE,
    LOGIN,
    LOGIN_FAILED,
    LOGOUT,
    EXPORT,
    PERMISSION_CHANGE,
    EMERGENCY_ACCESS,
    ;

    val stringKey: String get() = "audit.action.$name"

    /** The ones a reader scanning for trouble is scanning for. */
    val isNotable: Boolean
        get() = this == EXPORT || this == DELETE || this == PERMISSION_CHANGE ||
            this == EMERGENCY_ACCESS || this == LOGIN_FAILED
}

@Serializable
data class AuditEntry(
    val id: String,
    /** Null for anonymous events — a failed sign-in with an unknown identifier. */
    val actorId: String? = null,
    val actorRole: UserRole? = null,
    val action: AuditAction,
    val entityType: String,
    val entityId: String? = null,
    val patientId: String? = null,
    val ipAddress: String? = null,
    val createdAt: String,
) {
    val roleKey: String? get() = actorRole?.stringKey

    /**
     * The catalogue key for the table's own name.
     *
     * A caller that finds nothing behind it shows `entityType` verbatim: a log
     * that hides a row because the app has no word for its table is a log with
     * a gap in it, and the gap is invisible.
     */
    val entityKey: String get() = "audit.entity.$entityType"
}

@Serializable
data class AuditPage(
    val items: List<AuditEntry> = emptyList(),
    val nextCursor: String? = null,
)

/** A pattern the server thought worth pointing at (spec M13). */
@Serializable
data class AuditAnomaly(
    val kind: String,
    val actorId: String? = null,
    val actorRole: UserRole? = null,
    val count: Int = 0,
    val windowStart: String,
    val windowEnd: String,
    /**
     * The server's own sentence.
     *
     * Rendered rather than re-worded: it knows what it counted and the client
     * does not.
     */
    val detail: String,
) {
    val stringKey: String get() = "audit.anomaly.$kind"
}

/** What to narrow the log by. Every field is optional; all of them are ANDed. */
data class AuditFilter(
    val actorId: String? = null,
    val actorRole: UserRole? = null,
    val action: AuditAction? = null,
    val patientId: String? = null,
    val entityType: String? = null,
    /** ISO-8601. */
    val from: String? = null,
    val to: String? = null,
    val cursor: String? = null,
    val limit: Int? = null,
) {
    internal fun query(): String = buildList {
        actorId?.let { add("actorId=$it") }
        actorRole?.let { add("actorRole=${it.name}") }
        action?.let { add("action=${it.name}") }
        patientId?.let { add("patientId=$it") }
        entityType?.let { add("entityType=$it") }
        from?.let { add("from=$it") }
        to?.let { add("to=$it") }
        cursor?.let { add("cursor=$it") }
        limit?.let { add("limit=$it") }
    }.joinToString("&")
}

class AuditApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    suspend fun entries(filter: AuditFilter = AuditFilter()): AuditPage {
        val query = filter.query()
        val path = if (query.isEmpty()) "audit" else "audit?$query"

        return decode(client.send(Endpoint(HttpMethod.GET, path)))
    }

    /** Patterns worth a second look, over the last window the server keeps. */
    suspend fun anomalies(): List<AuditAnomaly> =
        decode(client.send(Endpoint(HttpMethod.GET, "audit/anomalies")))

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
