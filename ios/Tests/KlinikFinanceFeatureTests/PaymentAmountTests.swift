import XCTest
@testable import KlinikFinanceFeature

/**
 * The one place the finance screen touches a number.
 *
 * Everything else on that screen is a string the server produced. This is a
 * normalisation on the way back — and getting it wrong means sending "1.250,00"
 * to a server that reads it as one thousand two hundred and fifty point
 * nothing, or refuses it.
 */
final class PaymentAmountTests: XCTestCase {
    func testACommaIsAcceptedAsADecimalSeparator() {
        XCTAssertEqual(PaymentSheet.normalised("1250,50"), "1250.50")
        XCTAssertEqual(PaymentSheet.normalised("1250.50"), "1250.50")
    }

    func testSpacesAreStripped() {
        XCTAssertEqual(PaymentSheet.normalised("  1250 , 50 "), "1250.50")
    }

    /// A payment of nothing is not a payment, and a negative one is a refund —
    /// which is a different endpoint with its own reason field.
    func testZeroAndNegativeAreRefused() {
        XCTAssertNil(PaymentSheet.normalised("0"))
        XCTAssertNil(PaymentSheet.normalised("0,00"))
        XCTAssertNil(PaymentSheet.normalised("-100"))
    }

    func testNonsenseIsRefused() {
        XCTAssertNil(PaymentSheet.normalised(""))
        XCTAssertNil(PaymentSheet.normalised("   "))
        XCTAssertNil(PaymentSheet.normalised("bin lira"))
    }
}
