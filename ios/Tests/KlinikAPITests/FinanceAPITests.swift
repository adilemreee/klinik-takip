import XCTest
import KlinikCore
@testable import KlinikAPI

/**
 * Finance records and reports, as the finance desk's screen sees them
 * (spec M11, T6.3).
 *
 * Two properties are being defended. Amounts must survive the trip as decimals
 * — a screen that adds a column of doubles will disagree with the server by a
 * kuruş, and that is the one disagreement a finance desk cannot ignore. And a
 * total that could not convert everything must not read as a complete one.
 */
final class FinanceAPITests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder.klinik.decode(type, from: Data(json.utf8))
    }

    func testKeepsTheAmountTheServerStated() throws {
        let amount = Amount("4500.10")

        XCTAssertEqual(amount.value, Decimal(string: "4500.10"))
        // The original string is kept too, so a figure is displayed as the
        // server stated it rather than re-formatted through anything.
        XCTAssertEqual(amount.text, "4500.10")
    }

    func testAddsAmountsWithoutTheDriftADoubleWouldHave() throws {
        // A hundred payments of a kuruş. In binary floating point they come to
        // 1.0000000000000007; a finance desk reconciling against a bank
        // statement has to be able to add them and get one lira.
        var asDouble = 0.0
        var asDecimal = Decimal.zero

        for _ in 0..<100 {
            asDouble += 0.01
            asDecimal += Amount("0.01").value
        }

        XCTAssertNotEqual(asDouble, 1.0)
        XCTAssertEqual(asDecimal, Decimal(string: "1.00"))
    }

    func testRefusesSomethingThatIsNotAnAmount() {
        XCTAssertThrowsError(try decode(Amount.self, "\"not-money\""))
    }

    func testReadsABillWithItsLedger() throws {
        let record = try decode(
            FinanceRecord.self,
            #"""
            {"id":"f1","patientId":"p1",
             "patient":{"id":"p1","mrn":"MRN-9","firstName":"Ayşe","lastName":"Yılmaz","country":"DE"},
             "procedureName":"Rinoplasti","currency":"EUR",
             "grossAmount":"4500.00","discount":"500.00","netAmount":"4000.00",
             "paidAmount":"1500.00","refundedAmount":"0.00","balance":"2500.00",
             "paymentStatus":"PARTIAL","paidAt":null,"cancelledAt":null,
             "agencyId":null,"agencyName":null,"agencyCommission":null,"note":null,
             "payments":[{"id":"pay1","kind":"PAYMENT","amount":"1500.00","currency":"EUR",
               "appliedAmount":"1500.00","rate":null,"method":"BANK_TRANSFER",
               "paidAt":"2026-03-02T10:00:00.000Z","reference":"TR-88","note":null,
               "reversedAt":null,"reversalReason":null}],
             "createdAt":"2026-03-01T09:00:00.000Z"}
            """#
        )

        XCTAssertEqual(record.paymentStatus, .partial)
        XCTAssertTrue(record.paymentStatus.isOutstanding)
        XCTAssertEqual(record.balance.value, Decimal(string: "2500.00"))
        XCTAssertEqual(record.patient?.fullName, "Ayşe Yılmaz")
        XCTAssertEqual(record.livePayments.count, 1)
    }

    /** A corrected payment stays on the record and stops counting. */
    func testAReversedPaymentIsStillOnTheRecordButNotInTheTotal() throws {
        let record = try decode(
            FinanceRecord.self,
            #"""
            {"id":"f1","patientId":"p1","patient":null,"procedureName":"Rinoplasti",
             "currency":"EUR","grossAmount":"4000.00","discount":"0.00","netAmount":"4000.00",
             "paidAmount":"0.00","refundedAmount":"0.00","balance":"4000.00",
             "paymentStatus":"PENDING","paidAt":null,"cancelledAt":null,
             "agencyId":null,"agencyName":null,"agencyCommission":null,"note":null,
             "payments":[{"id":"pay1","kind":"PAYMENT","amount":"4000.00","currency":"EUR",
               "appliedAmount":"4000.00","rate":null,"method":"CASH",
               "paidAt":"2026-03-02T10:00:00.000Z","reference":null,"note":null,
               "reversedAt":"2026-03-03T08:00:00.000Z","reversalReason":"Yanlış hasta"}],
             "createdAt":"2026-03-01T09:00:00.000Z"}
            """#
        )

        XCTAssertEqual(record.payments.count, 1)
        XCTAssertTrue(record.payments[0].isReversed)
        XCTAssertTrue(record.livePayments.isEmpty)
        XCTAssertEqual(record.paymentStatus, .pending)
    }

    func testShowsAnOverpaymentRatherThanHidingIt() throws {
        let record = try decode(
            FinanceRecord.self,
            #"""
            {"id":"f1","patientId":"p1","patient":null,"procedureName":"Rinoplasti",
             "currency":"EUR","grossAmount":"4000.00","discount":"0.00","netAmount":"4000.00",
             "paidAmount":"4500.00","refundedAmount":"0.00","balance":"-500.00",
             "paymentStatus":"PAID","paidAt":"2026-03-05T10:00:00.000Z","cancelledAt":null,
             "agencyId":null,"agencyName":null,"agencyCommission":null,"note":null,
             "payments":[],"createdAt":"2026-03-01T09:00:00.000Z"}
            """#
        )

        XCTAssertTrue(record.isOverpaid)
        XCTAssertTrue(record.balance.isNegative)
    }

    func testATotalThatCouldNotConvertEverythingSaysSo() throws {
        let totals = try decode(
            Totals.self,
            #"""
            {"currency":"TRY","converted":"38000.00",
             "byCurrency":[{"currency":"GBP","amount":"2000.00"},{"currency":"EUR","amount":"1000.00"}],
             "unconverted":[{"currency":"GBP","amount":"2000.00"}],
             "complete":false}
            """#
        )

        // The screen must not present 38.000 ₺ as the answer: two thousand
        // pounds are outside it.
        XCTAssertFalse(totals.isWholeAnswer)
        XCTAssertEqual(totals.unconverted.first?.currency, .sterling)
        XCTAssertEqual(totals.byCurrency.count, 2)
    }

    func testACompleteTotalSaysThatToo() throws {
        let totals = try decode(
            Totals.self,
            #"""
            {"currency":"TRY","converted":"78000.00",
             "byCurrency":[{"currency":"EUR","amount":"2000.00"}],
             "unconverted":[],"complete":true}
            """#
        )

        XCTAssertTrue(totals.isWholeAnswer)
        XCTAssertTrue(totals.unconverted.isEmpty)
    }

    func testReadsTheCollectionReport() throws {
        let report = try decode(
            CollectionReport.self,
            #"""
            {"from":"2026-03-01T00:00:00.000Z","to":"2026-03-31T00:00:00.000Z","currency":"TRY",
             "received":{"currency":"TRY","converted":"78000.00","byCurrency":[],"unconverted":[],"complete":true},
             "refunded":{"currency":"TRY","converted":"1000.00","byCurrency":[],"unconverted":[],"complete":true},
             "net":{"currency":"TRY","converted":"77000.00","byCurrency":[],"unconverted":[],"complete":true},
             "byMethod":[{"method":"BANK_TRANSFER","totals":{"currency":"TRY","converted":"77000.00","byCurrency":[],"unconverted":[],"complete":true}}],
             "paymentCount":2}
            """#
        )

        XCTAssertEqual(report.net.converted.value, Decimal(string: "77000.00"))
        XCTAssertEqual(report.byMethod.first?.method, .bankTransfer)
    }

    func testHasAWordForEveryStatusAndMethod() {
        for status in PaymentStatus.allCases {
            XCTAssertNotEqual(status.localizedName, "finance.status.\(status.rawValue)")
        }
        for method in PaymentMethod.allCases {
            XCTAssertNotEqual(method.localizedName, "finance.method.\(method.rawValue)")
        }
    }

    func testHasASymbolForEveryCurrency() {
        XCTAssertEqual(Set(Currency.allCases.map(\.symbol)).count, Currency.allCases.count)
    }

    func testNamesEveryAgeingBucket() throws {
        let report = try decode(
            OutstandingReport.self,
            #"""
            {"currency":"TRY",
             "outstanding":{"currency":"TRY","converted":"10000.00","byCurrency":[],"unconverted":[],"complete":true},
             "ageing":[
               {"bucket":"current","totals":{"currency":"TRY","converted":"5000.00","byCurrency":[],"unconverted":[],"complete":true},"recordCount":2},
               {"bucket":"d30","totals":{"currency":"TRY","converted":"3000.00","byCurrency":[],"unconverted":[],"complete":true},"recordCount":1},
               {"bucket":"d60","totals":{"currency":"TRY","converted":"2000.00","byCurrency":[],"unconverted":[],"complete":true},"recordCount":1},
               {"bucket":"over90","totals":{"currency":"TRY","converted":"0.00","byCurrency":[],"unconverted":[],"complete":true},"recordCount":0}],
             "recordCount":4}
            """#
        )

        for bucket in report.ageing {
            XCTAssertNotEqual(bucket.localizedName, "finance.ageing.\(bucket.bucket)")
            XCTAssertFalse(bucket.localizedName.isEmpty)
        }
    }

    /** The caveat that must stay on any incomplete total. */
    func testCarriesTheIncompleteTotalWarning() {
        XCTAssertNotEqual(L10n.string("finance.totals.incomplete"), "finance.totals.incomplete")
    }
}
