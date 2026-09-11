package xyz.klinik.feature.finance

import java.time.Instant
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.Currency
import xyz.klinik.network.FinanceApi
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.PaymentMethod
import xyz.klinik.network.PaymentStatus
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object FinanceRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading the ledger must not refresh a session")
}

private class FinanceTransport(private val bodies: Map<String, Pair<Int, String>>) : HttpTransport {
    val urls = mutableListOf<String>()
    val sentBodies = mutableListOf<String>()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        urls += path
        request.body?.let { sentBodies += it }

        val (status, body) = bodies[path.substringBefore("?")] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private fun record(id: String, balance: String, paid: String = "0") = """
    {"id":"$id","patientId":"p1","procedureName":"Rinoplasti","currency":"TRY",
     "grossAmount":"100000.00","discount":"0.00","netAmount":"100000.00",
     "paidAmount":"$paid","refundedAmount":"0.00","balance":"$balance",
     "paymentStatus":"PENDING","payments":[]}
""".trimIndent()

private fun page(vararg records: String, cursor: String? = null) = """
    {"items":[${records.joinToString(",")}],
     "nextCursor":${cursor?.let { "\"$it\"" } ?: "null"}}
""".trimIndent()

private const val TOTALS = """
    {"currency":"TRY","converted":"128400.00","byCurrency":[],"unconverted":[],"complete":true}
"""

private val OUTSTANDING = """
    {"currency":"TRY","outstanding":$TOTALS,"ageing":[],"recordCount":3}
""".trimIndent()

private val COLLECTIONS = """
    {"from":"2026-08-31T21:00:00Z","to":"2026-09-12T09:30:00Z","currency":"TRY",
     "received":$TOTALS,"refunded":$TOTALS,"net":$TOTALS,"byMethod":[],"paymentCount":4}
""".trimIndent()

/**
 * What has been billed and what has been paid (spec M11).
 *
 * The money itself is the server's arithmetic and is not re-done here. What is
 * held to is that a balance is never adjusted locally, that a reversal without
 * a reason never reaches the server, and that the picker moves the ledger as
 * well as the reports — otherwise two halves of one screen quote two
 * currencies.
 */
class FinanceModelTest {
    private fun transport(vararg bodies: Pair<String, Pair<Int, String>>) =
        FinanceTransport(bodies.toMap())

    private suspend fun model(
        transport: FinanceTransport,
        now: String = "2026-09-12T09:30:00Z",
    ): FinanceModel {
        val session = SessionManager(InMemoryTokenStore(), FinanceRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return FinanceModel(
            FinanceApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
            clock = { Instant.parse(now) },
            zone = ZoneId.of("Europe/Istanbul"),
        )
    }

    private fun loaded() = transport(
        "finance/records" to (200 to page(record("r1", "40000.00"))),
        "finance/outstanding" to (200 to OUTSTANDING),
        "finance/collections" to (200 to COLLECTIONS),
        "finance/rates" to (200 to "[]"),
    )

    @Test
    fun `the ledger and both reports arrive together`() = runTest {
        val subject = model(loaded())

        subject.load()

        val state = subject.state.value

        assertEquals(FinancePhase.Loaded, state.phase)
        assertEquals(listOf("r1"), state.records.map { it.id })
        assertNotNull(state.outstanding)
        assertNotNull(state.collections)
    }

    /** No `finance.read` is a permission answer, not a clinic that billed nothing. */
    @Test
    fun `nothing readable means the account has no finance screen`() = runTest {
        val subject = model(
            transport(
                "finance/records" to (403 to """{"message":"forbidden"}"""),
                "finance/outstanding" to (403 to """{"message":"forbidden"}"""),
                "finance/collections" to (403 to """{"message":"forbidden"}"""),
                "finance/rates" to (403 to """{"message":"forbidden"}"""),
            ),
        )

        subject.load()

        assertEquals(FinancePhase.NotPermitted, subject.state.value.phase)
    }

    /**
     * The picker moves the list too.
     *
     * Converting the reports and leaving the ledger in whatever each row was
     * billed in puts two currencies on one screen.
     */
    @Test
    fun `choosing a currency asks for the records in it as well`() = runTest {
        val transport = loaded()
        val subject = model(transport)

        subject.choose(Currency.EUR)

        assertTrue(
            transport.urls.any { it.startsWith("finance/records") && "currency=EUR" in it },
            transport.urls.toString(),
        )
    }

    @Test
    fun `choosing a status filters the ledger`() = runTest {
        val transport = loaded()
        val subject = model(transport)

        subject.choose(PaymentStatus.PENDING)

        assertTrue(transport.urls.any { it.startsWith("finance/records") && "status=PENDING" in it })
    }

    /** The collections and the rates cover the same window, so they read together. */
    @Test
    fun `the month's takings and the month's rates share a window`() = runTest {
        val transport = loaded()
        val subject = model(transport)

        subject.load()

        val collections = transport.urls.first { it.startsWith("finance/collections") }
        val rates = transport.urls.first { it.startsWith("finance/rates") }

        assertTrue("from=2026-08-31T21:00:00Z" in collections, collections)
        assertTrue("from=2026-08-31T21:00:00Z" in rates, rates)
    }

    /**
     * The row is replaced with what the server returned.
     *
     * Subtracting here would be the second place this clinic does arithmetic,
     * and the two would eventually disagree in front of a patient.
     */
    @Test
    fun `a payment takes the server's balance and not a local one`() = runTest {
        val transport = transport(
            "finance/records" to (200 to page(record("r1", "40000.00"))),
            "finance/outstanding" to (200 to OUTSTANDING),
            "finance/collections" to (200 to COLLECTIONS),
            "finance/rates" to (200 to "[]"),
            "finance/records/r1/payments" to (200 to record("r1", "15000.00", paid = "25000.00")),
        )
        val subject = model(transport)

        subject.load()
        val ok = subject.pay("r1", "25000.00", PaymentMethod.BANK_TRANSFER, reference = null)

        assertTrue(ok)
        assertEquals("15000.00", subject.state.value.records.single().balance)
        assertNull(subject.state.value.busyId)
    }

    /**
     * A reversal with no reason never leaves the phone.
     *
     * A ledger that forgets why a correction was made is a ledger nobody can
     * audit, and the server requires it — refusing here means the clinician is
     * told before the round trip rather than after.
     */
    @Test
    fun `a reversal without a reason is refused before the request`() = runTest {
        val transport = loaded()
        val subject = model(transport)

        subject.load()
        val ok = subject.reverse("pay1", "   ")

        assertFalse(ok)
        assertTrue(transport.urls.none { it.contains("reverse") }, transport.urls.toString())
        assertEquals("finance.reverseNeedsReason", (subject.state.value.error as? xyz.klinik.network.UiText.Key)?.key)
    }

    /** A failed payment leaves the row as the server last described it. */
    @Test
    fun `a failed payment does not change the balance`() = runTest {
        val subject = model(
            transport(
                "finance/records" to (200 to page(record("r1", "40000.00"))),
                "finance/outstanding" to (200 to OUTSTANDING),
                "finance/collections" to (200 to COLLECTIONS),
                "finance/rates" to (200 to "[]"),
                "finance/records/r1/payments" to (500 to "{}"),
            ),
        )

        subject.load()
        val ok = subject.pay("r1", "25000.00", PaymentMethod.CASH, reference = null)

        assertFalse(ok)
        assertEquals("40000.00", subject.state.value.records.single().balance)
        assertNotNull(subject.state.value.error)
        assertNull(subject.state.value.busyId)
    }

    @Test
    fun `the next page is appended rather than replacing the list`() = runTest {
        val transport = transport(
            "finance/records" to (200 to page(record("r1", "1.00"), cursor = "c1")),
            "finance/outstanding" to (200 to OUTSTANDING),
            "finance/collections" to (200 to COLLECTIONS),
            "finance/rates" to (200 to "[]"),
        )
        val subject = model(transport)

        subject.load()
        assertTrue(subject.state.value.hasMore)

        subject.loadMore()

        // The stub answers the same page for the cursor, which is enough to
        // show the list grew rather than being replaced.
        assertEquals(2, subject.state.value.records.size)
        assertTrue(transport.urls.any { it.contains("cursor=c1") })
    }
}
