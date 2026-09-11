package xyz.klinik.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

/**
 * Who did what to whose record (spec M13).
 *
 * The log is what makes the rest of the clinic answerable, so the client's
 * job is to lose none of it — including the rows whose table it has no word
 * for, and the events with nobody behind them.
 */
class AuditApiTest {
    @Test
    fun `an anonymous event keeps its place in the log`() {
        // A failed sign-in with an unknown identifier has no actor. Dropping it
        // would hide exactly the rows somebody auditing is looking for.
        val entry = json.decodeFromString<AuditEntry>(
            """
            {"id":"a1","actorId":null,"actorRole":null,"action":"LOGIN_FAILED",
             "entityType":"users","entityId":null,"patientId":null,
             "ipAddress":"203.0.113.9","createdAt":"2026-09-12T07:00:00.000Z"}
            """.trimIndent(),
        )

        assertNull(entry.actorId)
        assertNull(entry.roleKey)
        assertEquals(AuditAction.LOGIN_FAILED, entry.action)
        assertTrue(entry.action.isNotable)
    }

    /** The five a reader scanning for trouble is scanning for. */
    @Test
    fun `the notable actions are the ones worth a second look`() {
        assertEquals(
            setOf(
                AuditAction.EXPORT,
                AuditAction.DELETE,
                AuditAction.PERMISSION_CHANGE,
                AuditAction.EMERGENCY_ACCESS,
                AuditAction.LOGIN_FAILED,
            ),
            AuditAction.entries.filter { it.isNotable }.toSet(),
        )
    }

    /**
     * An unfamiliar table still has a key.
     *
     * The caller shows `entityType` verbatim when nothing is behind it — a log
     * that hid a row because the app has no word for its table would have an
     * invisible gap in it.
     */
    @Test
    fun `the entity key is derived from the table's own name`() {
        val entry = json.decodeFromString<AuditEntry>(
            """
            {"id":"a2","actorId":"u1","actorRole":"DOCTOR","action":"READ",
             "entityType":"some_new_table","entityId":"x","patientId":"p1",
             "ipAddress":null,"createdAt":"2026-09-12T07:00:00.000Z"}
            """.trimIndent(),
        )

        assertEquals("audit.entity.some_new_table", entry.entityKey)
        assertEquals("role.DOCTOR", entry.roleKey)
    }

    @Test
    fun `a page carries its cursor`() {
        val page = json.decodeFromString<AuditPage>(
            """{"items":[],"nextCursor":"c1"}""",
        )

        assertEquals("c1", page.nextCursor)
    }

    /** Every field the filter carries reaches the query, and none of the empty ones. */
    @Test
    fun `the filter sends only what was set`() {
        val query = AuditFilter(
            action = AuditAction.EXPORT,
            patientId = "p1",
            from = "2026-09-01T00:00:00Z",
        ).query()

        assertEquals("action=EXPORT&patientId=p1&from=2026-09-01T00:00:00Z", query)
        assertEquals("", AuditFilter().query())
    }

    /**
     * The anomaly's sentence is the server's.
     *
     * It knows what it counted; re-wording it here would be a client
     * describing a pattern it did not detect.
     */
    @Test
    fun `an anomaly is rendered in the server's own words`() {
        val anomaly = json.decodeFromString<AuditAnomaly>(
            """
            {"kind":"BULK_ACCESS","actorId":"u9","actorRole":"NURSE","count":120,
             "windowStart":"2026-09-11T00:00:00.000Z","windowEnd":"2026-09-12T00:00:00.000Z",
             "detail":"120 distinct patient files read"}
            """.trimIndent(),
        )

        assertEquals("audit.anomaly.BULK_ACCESS", anomaly.stringKey)
        assertEquals("120 distinct patient files read", anomaly.detail)
        assertEquals(UserRole.NURSE, anomaly.actorRole)
    }

    @Test
    fun `an ordinary read is not flagged`() {
        assertFalse(AuditAction.READ.isNotable)
        assertFalse(AuditAction.LOGIN.isNotable)
    }
}
