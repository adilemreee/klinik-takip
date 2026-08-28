import XCTest
@testable import KlinikMeasurementsFeature

/// Patients arrive from many countries and the clinic's own staff type in
/// Turkish, so both separators reach the same field.
final class DecimalEntryTests: XCTestCase {
    func testAcceptsEitherSeparator() {
        XCTAssertEqual(DecimalEntry.parse("72.4"), 72.4)
        XCTAssertEqual(DecimalEntry.parse("72,4"), 72.4)
    }

    func testAcceptsAWholeNumber() {
        XCTAssertEqual(DecimalEntry.parse("72"), 72)
    }

    func testIgnoresSurroundingSpace() {
        XCTAssertEqual(DecimalEntry.parse("  72,4 "), 72.4)
    }

    /// The dangerous case: a value that parses to *something* is worse than one
    /// that is refused, because a weight drives dosing.
    func testRefusesTextThatIsNotOnlyANumber() {
        XCTAssertNil(DecimalEntry.parse("72kg"))
        XCTAssertNil(DecimalEntry.parse("72 4"))
        XCTAssertNil(DecimalEntry.parse("-72"))
    }

    func testRefusesMoreThanOneSeparator() {
        XCTAssertNil(DecimalEntry.parse("72.4.5"))
        XCTAssertNil(DecimalEntry.parse("1,234.5"))
    }

    func testRefusesATrailingSeparator() {
        // Mid-typing, not a number yet: the save button must stay disabled
        // rather than send 72.
        XCTAssertNil(DecimalEntry.parse("72,"))
    }

    func testRefusesEmptyInput() {
        XCTAssertNil(DecimalEntry.parse(""))
        XCTAssertNil(DecimalEntry.parse("   "))
    }
}
