package xyz.klinik.feature.audit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.AuditAction
import xyz.klinik.network.AuditApi
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object AuditRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading the log must not refresh a session")
}

private class AuditTransport(private val bodies: Map<String, Pair<Int, String>>) : HttpTransport {
    val urls = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        urls += path

        val (status, body) = bodies[path.substringBefore("?")] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private fun entry(id: String, action: String = "READ") = """
    {"id":"$id","actorId":"u1","actorRole":"NURSE","action":"$action",
     "entityType":"patients","entityId":"p1","patientId":"p1",
     "ipAddress":"203.0.113.9","createdAt":"2026-09-12T07:00:00.000Z"}
""".trimIndent()

private const val ANOMALIES = """
    [{"kind":"BULK_ACCESS","actorId":"u1","actorRole":"NURSE","count":120,
      "windowStart":"2026-09-11T00:00:00.000Z","windowEnd":"2026-09-12T00:00:00.000Z",
      "detail":"120 distinct patient files read"}]
"""

/**
 * Who did what to whose record (spec M13).
 *
 * The anomalies are the reason somebody opens this screen — "a nurse read a
 * hundred and twenty files last night" is not a row anybody finds by
 * scrolling — so they arrive with the log, and the log still arrives when the
 * detector does not.
 */
class AuditModelTest {
    private fun transport(vararg bodies: Pair<String, Pair<Int, String>>) =
        AuditTransport(bodies.toMap())

    private suspend fun model(transport: AuditTransport): AuditModel {
        val session = SessionManager(InMemoryTokenStore(), AuditRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return AuditModel(
            AuditApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
        )
    }

    @Test
    fun `the anomalies arrive with the log`() = runTest {
        val subject = model(
            transport(
                "audit" to (200 to """{"items":[${entry("a1")}],"nextCursor":null}"""),
                "audit/anomalies" to (200 to ANOMALIES),
            ),
        )

        subject.load()

        assertEquals(1, subject.state.value.anomalies.size)
        assertEquals("audit.anomaly.BULK_ACCESS", subject.state.value.anomalies.single().stringKey)
    }

    /**
     * A clinic entitled to read the log gets it even when the detector is
     * down. Failing the whole screen on the optional half would hide the log
     * for the sake of a feature nobody asked for at that moment.
     */
    @Test
    fun `the log still loads when the detector fails`() = runTest {
        val subject = model(
            transport(
                "audit" to (200 to """{"items":[${entry("a1")}],"nextCursor":null}"""),
                "audit/anomalies" to (500 to "{}"),
            ),
        )

        subject.load()

        assertEquals(AuditPhase.Loaded, subject.state.value.phase)
        assertTrue(subject.state.value.anomalies.isEmpty())
    }

    /** Nothing matched a filter is not an empty log and not a failure. */
    @Test
    fun `an empty result is its own state`() = runTest {
        val subject = model(
            transport(
                "audit" to (200 to """{"items":[],"nextCursor":null}"""),
                "audit/anomalies" to (200 to "[]"),
            ),
        )

        subject.load()

        assertEquals(AuditPhase.Empty, subject.state.value.phase)
    }

    @Test
    fun `choosing an action narrows the query on the server`() = runTest {
        val transport = transport(
            "audit" to (200 to """{"items":[${entry("a1", "EXPORT")}],"nextCursor":null}"""),
            "audit/anomalies" to (200 to "[]"),
        )
        val subject = model(transport)

        subject.choose(AuditAction.EXPORT)

        assertTrue(transport.urls.any { it.startsWith("audit?") && "action=EXPORT" in it })
    }

    /** The next page is appended: a log read in pieces is still one log. */
    @Test
    fun `the next page joins the end of the list`() = runTest {
        val transport = transport(
            "audit" to (200 to """{"items":[${entry("a1")}],"nextCursor":"c1"}"""),
            "audit/anomalies" to (200 to "[]"),
        )
        val subject = model(transport)

        subject.load()
        assertTrue(subject.state.value.hasMore)

        subject.loadMore()

        assertEquals(2, subject.state.value.entries.size)
        assertTrue(transport.urls.any { "cursor=c1" in it })
    }

    @Test
    fun `a forbidden account is told so rather than shown an error`() = runTest {
        val subject = model(
            transport(
                "audit" to (403 to """{"message":"forbidden"}"""),
                "audit/anomalies" to (403 to """{"message":"forbidden"}"""),
            ),
        )

        subject.load()

        assertEquals(AuditPhase.NotPermitted, subject.state.value.phase)
    }
}
