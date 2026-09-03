package xyz.klinik.network

import java.math.BigDecimal
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

/**
 * Finance records and reports, as the finance desk's screen sees them
 * (spec M11, T6.3).
 *
 * Two properties are being defended. Amounts must survive the trip as decimals
 * — a screen that adds a column of doubles will disagree with the server by a
 * kuruş, and that is the one disagreement a finance desk cannot ignore. And a
 * total that could not convert everything must not read as a complete one.
 */
class FinanceApiTest {
    @Test
    fun `adds amounts without the drift a double would have`() {
        // A hundred payments of a kuruş. In binary floating point they come to
        // 1.0000000000000007; the finance desk has to be able to add them and
        // get one lira.
        var asDouble = 0.0
        var asDecimal = BigDecimal.ZERO

        repeat(100) {
            asDouble += 0.01
            asDecimal = asDecimal.add(BigDecimal("0.01"))
        }

        assertNotEquals(1.0, asDouble)
        assertEquals(0, asDecimal.compareTo(BigDecimal("1.00")))
    }

    @Test
    fun `reads a bill with its ledger`() {
        val record = json.decodeFromString<FinanceRecord>(
            """
            {"id":"f1","patientId":"p1",
             "patient":{"id":"p1","mrn":"MRN-9","firstName":"Ayşe","lastName":"Yılmaz","country":"DE"},
             "procedureName":"Rinoplasti","currency":"EUR",
             "grossAmount":"4500.00","discount":"500.00","netAmount":"4000.00",
             "paidAmount":"1500.00","refundedAmount":"0.00","balance":"2500.00",
             "paymentStatus":"PARTIAL",
             "payments":[{"id":"pay1","kind":"PAYMENT","amount":"1500.00","currency":"EUR",
               "appliedAmount":"1500.00","method":"BANK_TRANSFER",
               "paidAt":"2026-03-02T10:00:00.000Z","reference":"TR-88"}]}
            """.trimIndent(),
        )

        assertEquals(PaymentStatus.PARTIAL, record.paymentStatus)
        assertTrue(record.paymentStatus.isOutstanding)
        assertEquals(0, record.outstanding.compareTo(BigDecimal("2500.00")))
        assertEquals("Ayşe Yılmaz", record.patient?.fullName)
        assertEquals(1, record.livePayments.size)
    }

    /** A corrected payment stays on the record and stops counting. */
    @Test
    fun `a reversed payment is still on the record but not in the total`() {
        val record = json.decodeFromString<FinanceRecord>(
            """
            {"id":"f1","patientId":"p1","procedureName":"Rinoplasti","currency":"EUR",
             "grossAmount":"4000.00","discount":"0.00","netAmount":"4000.00",
             "paidAmount":"0.00","refundedAmount":"0.00","balance":"4000.00",
             "paymentStatus":"PENDING",
             "payments":[{"id":"pay1","kind":"PAYMENT","amount":"4000.00","currency":"EUR",
               "appliedAmount":"4000.00","method":"CASH","paidAt":"2026-03-02T10:00:00.000Z",
               "reversedAt":"2026-03-03T08:00:00.000Z","reversalReason":"Yanlış hasta"}]}
            """.trimIndent(),
        )

        assertEquals(1, record.payments.size)
        assertTrue(record.payments[0].isReversed)
        assertTrue(record.livePayments.isEmpty())
        assertEquals(PaymentStatus.PENDING, record.paymentStatus)
    }

    @Test
    fun `shows an overpayment rather than hiding it`() {
        val record = json.decodeFromString<FinanceRecord>(
            """
            {"id":"f1","patientId":"p1","procedureName":"Rinoplasti","currency":"EUR",
             "grossAmount":"4000.00","discount":"0.00","netAmount":"4000.00",
             "paidAmount":"4500.00","refundedAmount":"0.00","balance":"-500.00",
             "paymentStatus":"PAID"}
            """.trimIndent(),
        )

        assertTrue(record.isOverpaid)
    }

    @Test
    fun `a total that could not convert everything says so`() {
        val totals = json.decodeFromString<Totals>(
            """
            {"currency":"TRY","converted":"38000.00",
             "byCurrency":[{"currency":"GBP","amount":"2000.00"},{"currency":"EUR","amount":"1000.00"}],
             "unconverted":[{"currency":"GBP","amount":"2000.00"}],
             "complete":false}
            """.trimIndent(),
        )

        // The screen must not present 38.000 ₺ as the answer: two thousand
        // pounds are outside it.
        assertFalse(totals.isWholeAnswer)
        assertEquals(Currency.GBP, totals.unconverted.first().currency)
        assertEquals(2, totals.byCurrency.size)
    }

    @Test
    fun `a complete total says that too`() {
        val totals = json.decodeFromString<Totals>(
            """{"currency":"TRY","converted":"78000.00","byCurrency":[],"unconverted":[],"complete":true}""",
        )

        assertTrue(totals.isWholeAnswer)
        assertEquals(0, totals.value.compareTo(BigDecimal("78000.00")))
    }

    @Test
    fun `reads the collection report`() {
        val report = json.decodeFromString<CollectionReport>(
            """
            {"from":"2026-03-01T00:00:00.000Z","to":"2026-03-31T00:00:00.000Z","currency":"TRY",
             "received":{"currency":"TRY","converted":"78000.00","complete":true},
             "refunded":{"currency":"TRY","converted":"1000.00","complete":true},
             "net":{"currency":"TRY","converted":"77000.00","complete":true},
             "byMethod":[{"method":"BANK_TRANSFER",
               "totals":{"currency":"TRY","converted":"77000.00","complete":true}}],
             "paymentCount":2}
            """.trimIndent(),
        )

        assertEquals(0, report.net.value.compareTo(BigDecimal("77000.00")))
        assertEquals(PaymentMethod.BANK_TRANSFER, report.byMethod.first().method)
    }

    @Test
    fun `has a string key for every status, method and bucket`() {
        for (status in PaymentStatus.entries) {
            assertTrue(status.stringKey.startsWith("finance_status_"))
        }
        for (method in PaymentMethod.entries) {
            assertTrue(method.stringKey.startsWith("finance_method_"))
        }
        assertEquals("finance_ageing_over90", AgeingBucket("over90", emptyTotals(), 0).stringKey)
    }

    @Test
    fun `has a distinct symbol for every currency`() {
        assertEquals(Currency.entries.size, Currency.entries.map { it.symbol }.toSet().size)
    }

    /** An older server sends a record without the patient block; not a crash. */
    @Test
    fun `tolerates a record without a patient block`() {
        val record = json.decodeFromString<FinanceRecord>(
            """
            {"id":"f1","patientId":"p1","procedureName":"Rinoplasti","currency":"TRY",
             "grossAmount":"100.00","discount":"0.00","netAmount":"100.00",
             "paidAmount":"0.00","refundedAmount":"0.00","balance":"100.00",
             "paymentStatus":"PENDING"}
            """.trimIndent(),
        )

        assertEquals(null, record.patient)
        assertTrue(record.payments.isEmpty())
    }

    private fun emptyTotals(): Totals = Totals(Currency.TRY, "0.00")
}
