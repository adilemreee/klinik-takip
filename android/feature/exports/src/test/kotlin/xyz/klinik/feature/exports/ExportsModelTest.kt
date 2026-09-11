package xyz.klinik.feature.exports

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ExportFormat
import xyz.klinik.network.ExportsApi
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object ExportRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading the export list must not refresh a session")
}

private class ExportTransport(private val bodies: Map<String, Pair<Int, String>>) : HttpTransport {
    val calls = mutableListOf<String>()
    val sentBodies = mutableListOf<String>()
    var statusAnswer: String? = null

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        calls += "${request.method} $path"
        request.body?.let { sentBodies += it }

        statusAnswer?.let { answer ->
            if (request.method == "GET" && path.startsWith("exports/") && "/" !in path.drop(8)) {
                return HttpResponse(200, answer)
            }
        }

        val (status, body) = bodies["${request.method} $path"] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private fun request(id: String, status: String, createdAt: String) = """
    {"id":"$id","kind":"PATIENT_LIST","status":"$status","size":null,
     "contents":null,"error":null,"expiresAt":null,"createdAt":"$createdAt"}
""".trimIndent()

private const val COLUMNS = """
    [{"key":"fullName","header":"Ad soyad","group":"patient","permission":"patients.read","available":true},
     {"key":"passportNo","header":"Pasaport","group":"patient","permission":"patients.pii","available":false},
     {"key":"netAmount","header":"Net","group":"finance","permission":"finance.read","available":true}]
"""

/**
 * Taking data out of the clinic (spec M12).
 *
 * Everything here is audited on the server. What the client must not do is
 * make any of it invisible — so nothing downloads itself, and a column this
 * viewer may not take is offered as unavailable rather than quietly dropped.
 */
class ExportsModelTest {
    private fun transport(vararg bodies: Pair<String, Pair<Int, String>>) =
        ExportTransport(bodies.toMap())

    private suspend fun model(transport: ExportTransport): ExportsModel {
        val session = SessionManager(InMemoryTokenStore(), ExportRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return ExportsModel(
            ExportsApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
        )
    }

    private fun loaded() = transport(
        "GET exports" to (
            200 to "[${request("e1", "QUEUED", "2026-09-10T08:00:00.000Z")}," +
                "${request("e2", "DONE", "2026-09-11T08:00:00.000Z")}]"
            ),
        "GET exports/columns" to (200 to COLUMNS),
    )

    /** Newest first: the export somebody just asked for is the one they want. */
    @Test
    fun `the newest request is at the top`() = runTest {
        val subject = model(loaded())

        subject.load()

        assertEquals(listOf("e2", "e1"), subject.state.value.requests.map { it.id })
    }

    /**
     * A first visit starts with everything this viewer may take.
     *
     * The common case is "all of it", and unticking three is faster than
     * ticking forty.
     */
    @Test
    fun `the picker opens with every permitted column and no others`() = runTest {
        val subject = model(loaded())

        subject.load()

        assertEquals(setOf("fullName", "netAmount"), subject.state.value.chosen)
    }

    /**
     * A column this viewer cannot take is still listed.
     *
     * Hiding it would make an incomplete spreadsheet look like a complete one,
     * and somebody would go looking for the passport number in a worse place.
     */
    @Test
    fun `an unavailable column is offered rather than hidden`() = runTest {
        val subject = model(loaded())

        subject.load()

        val passport = subject.state.value.columns.single { it.key == "passportNo" }

        assertFalse(passport.available)
    }

    @Test
    fun `columns are grouped the way the catalogue groups them`() = runTest {
        val subject = model(loaded())

        subject.load()

        assertEquals(
            listOf("finance" to 1, "patient" to 2),
            subject.state.value.groupedColumns.map { it.first to it.second.size },
        )
    }

    /** Only what was ticked goes up, and in a stable order. */
    @Test
    fun `the request carries exactly the chosen columns`() = runTest {
        val transport = loaded()
        val subject = model(transport)

        subject.load()
        subject.toggle("netAmount")
        subject.choose(ExportFormat.XLSX)

        transport.calls.clear()
        subject.requestPatientList(from = null, to = null, country = "DE")

        val body = transport.sentBodies.last()

        assertTrue("\"fullName\"" in body, body)
        assertFalse("netAmount" in body, body)
        assertTrue("XLSX" in body, body)
        assertTrue("\"DE\"" in body, body)
    }

    /** An empty country box is no filter, not a filter for the empty string. */
    @Test
    fun `a blank country is not sent as a filter`() = runTest {
        val transport = transport(
            "GET exports" to (200 to "[]"),
            "GET exports/columns" to (200 to COLUMNS),
            "POST exports/patients" to (200 to request("e9", "QUEUED", "2026-09-12T08:00:00.000Z")),
        )
        val subject = model(transport)

        subject.load()
        subject.requestPatientList(from = null, to = null, country = "   ")

        assertTrue("\"country\":null" in transport.sentBodies.last() ||
            "country" !in transport.sentBodies.last(), transport.sentBodies.last())
    }

    /**
     * Only the unfinished ones are re-read.
     *
     * A finished export never changes, and polling forty of them every three
     * seconds is a battery complaint.
     */
    @Test
    fun `refreshing asks only about the ones still working`() = runTest {
        val transport = loaded()
        val subject = model(transport)

        subject.load()
        transport.calls.clear()
        transport.statusAnswer = request("e1", "DONE", "2026-09-10T08:00:00.000Z")

        subject.refreshUnfinished()

        assertEquals(listOf("GET exports/e1"), transport.calls)
        assertFalse(subject.state.value.hasUnfinished)
    }

    /**
     * The link is asked for, never taken.
     *
     * Requesting one is recorded in the audit log, so it happens on a press
     * rather than as soon as the file is ready.
     */
    @Test
    fun `the download link is only fetched when asked for`() = runTest {
        val transport = transport(
            "GET exports" to (200 to "[${request("e2", "DONE", "2026-09-11T08:00:00.000Z")}]"),
            "GET exports/columns" to (200 to COLUMNS),
            "POST exports/e2/download" to (
                200 to """{"url":"https://files.test/e2.csv","expiresAt":"2026-09-12T10:00:00.000Z","filename":"e2.csv"}"""
                ),
        )
        val subject = model(transport)

        subject.load()
        assertTrue(transport.calls.none { it.contains("download") })

        val url = subject.download("e2")

        assertEquals("https://files.test/e2.csv", url)
    }

    @Test
    fun `a refused link says why and returns nothing`() = runTest {
        val subject = model(
            transport(
                "GET exports" to (200 to "[${request("e2", "DONE", "2026-09-11T08:00:00.000Z")}]"),
                "GET exports/columns" to (200 to COLUMNS),
                "POST exports/e2/download" to (403 to """{"message":"forbidden"}"""),
            ),
        )

        subject.load()

        assertNull(subject.download("e2"))
        assertNotNull(subject.state.value.error)
    }

    @Test
    fun `nothing readable means the account has no export screen`() = runTest {
        val subject = model(
            transport(
                "GET exports" to (403 to """{"message":"forbidden"}"""),
                "GET exports/columns" to (403 to """{"message":"forbidden"}"""),
            ),
        )

        subject.load()

        assertEquals(ExportsPhase.NotPermitted, subject.state.value.phase)
    }
}
