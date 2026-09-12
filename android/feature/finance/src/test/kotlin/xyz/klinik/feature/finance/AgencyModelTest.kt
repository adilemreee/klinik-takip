package xyz.klinik.feature.finance

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.FinanceApi
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object AgencyRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading agencies must not refresh a session")
}

private class AgencyTransport(private val bodies: Map<String, Pair<Int, String>>) : HttpTransport {
    val sent = mutableListOf<Pair<String, String>>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        sent += "${request.method} $path" to request.body.orEmpty()

        val (status, body) = bodies["${request.method} $path"] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private fun agency(id: String, name: String, rate: String?, active: Boolean = true) = """
    {"id":"$id","name":"$name","country":"DE","contactName":null,"contactEmail":null,
     "contactPhone":null,"commissionRate":${rate?.let { "\"$it\"" } ?: "null"},
     "isActive":$active}
""".trimIndent()

/**
 * Who sends the clinic patients, and on what commission (spec M11).
 *
 * The percentage-to-fraction conversion is the whole risk here: getting it
 * backwards multiplies an invoice by a hundred.
 */
class AgencyModelTest {
    private suspend fun model(transport: AgencyTransport): AgencyModel {
        val session = SessionManager(InMemoryTokenStore(), AgencyRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return AgencyModel(
            FinanceApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
        )
    }

    /**
     * "Ten percent" goes up as `0.1000`.
     *
     * The person types what they would say; the server wants the fraction, and
     * the two differ by a factor of a hundred.
     */
    @Test
    fun `a percentage is sent as a fraction`() = runTest {
        val transport = AgencyTransport(
            mapOf(
                "GET finance/agencies" to (200 to "[]"),
                "POST finance/agencies" to (200 to agency("a1", "Reise GmbH", "0.1000")),
            ),
        )
        val subject = model(transport)

        subject.load()
        subject.add("Reise GmbH", "DE", null, null, null, commissionPercent = 10)

        assertTrue(
            "\"commissionRate\":\"0.1000\"" in transport.sent.last().second,
            transport.sent.last().second,
        )
    }

    /** And comes back as a percentage for the screen to show. */
    @Test
    fun `a fraction reads back as a percentage`() = runTest {
        val subject = model(
            AgencyTransport(
                mapOf("GET finance/agencies" to (200 to "[${agency("a1", "Reise", "0.1500")}]")),
            ),
        )

        subject.load()

        assertEquals(15, subject.state.value.agencies.single().commissionPercent)
    }

    /** No rate agreed is null, not zero — those are different arrangements. */
    @Test
    fun `no commission is not a commission of nothing`() = runTest {
        val subject = model(
            AgencyTransport(
                mapOf("GET finance/agencies" to (200 to "[${agency("a1", "Reise", null)}]")),
            ),
        )

        subject.load()

        assertEquals(null, subject.state.value.agencies.single().commissionPercent)
    }

    /**
     * Switched off stays on the screen.
     *
     * Its invoices still carry its commission, and hiding it leaves those
     * naming something a reader cannot look up.
     */
    @Test
    fun `an agency switched off is still listed`() = runTest {
        val subject = model(
            AgencyTransport(
                mapOf(
                    "GET finance/agencies" to (200 to "[${agency("a1", "Reise", "0.1000")}]"),
                    "PATCH finance/agencies/a1" to (
                        200 to agency("a1", "Reise", "0.1000", active = false)
                        ),
                ),
            ),
        )

        subject.load()

        assertTrue(subject.setActive(subject.state.value.agencies.single(), active = false))
        assertEquals(1, subject.state.value.agencies.size)
        assertEquals(listOf("a1"), subject.state.value.inactive.map { it.id })
        assertTrue(subject.state.value.active.isEmpty())
    }

    /** Only `isActive` is sent: the rest of the record is not being rewritten. */
    @Test
    fun `switching off does not resend the whole record`() = runTest {
        val transport = AgencyTransport(
            mapOf(
                "GET finance/agencies" to (200 to "[${agency("a1", "Reise", "0.1000")}]"),
                "PATCH finance/agencies/a1" to (
                    200 to agency("a1", "Reise", "0.1000", active = false)
                    ),
            ),
        )
        val subject = model(transport)

        subject.load()
        subject.setActive(subject.state.value.agencies.single(), active = false)

        val body = transport.sent.last { it.first.startsWith("PATCH") }.second

        assertTrue("\"isActive\":false" in body, body)
        assertFalse("commissionRate\":\"" in body, body)
    }

    @Test
    fun `none defined is its own state`() = runTest {
        val subject = model(AgencyTransport(mapOf("GET finance/agencies" to (200 to "[]"))))

        subject.load()

        assertEquals(AgencyPhase.Empty, subject.state.value.phase)
    }

    @Test
    fun `a refused change leaves the agency as it was`() = runTest {
        val subject = model(
            AgencyTransport(
                mapOf(
                    "GET finance/agencies" to (200 to "[${agency("a1", "Reise", "0.1000")}]"),
                    "PATCH finance/agencies/a1" to (403 to """{"message":"forbidden"}"""),
                ),
            ),
        )

        subject.load()

        assertFalse(subject.setActive(subject.state.value.agencies.single(), active = false))
        assertEquals(1, subject.state.value.active.size)
        assertNotNull(subject.state.value.error)
    }
}
