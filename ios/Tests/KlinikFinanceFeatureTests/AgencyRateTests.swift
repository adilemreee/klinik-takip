import XCTest
@testable import KlinikFinanceFeature

/**
 * A percentage typed by a person, as the server's fraction.
 *
 * The field asks for a percentage because that is what a contract says, and the
 * column stores a fraction of one. Sending "10" where "0.1000" was meant would
 * bill an agency ten times the operation — which is exactly the sort of error
 * that survives a code review and is found by an accountant.
 */
final class AgencyRateTests: XCTestCase {
    func testTenPerCentBecomesAFractionOfOne() {
        XCTAssertEqual(AgenciesModel.rate(fromPercentage: "10"), "0.1000")
        XCTAssertEqual(AgenciesModel.rate(fromPercentage: "12.5"), "0.1250")
        XCTAssertEqual(AgenciesModel.rate(fromPercentage: "12,5"), "0.1250")
        XCTAssertEqual(AgenciesModel.rate(fromPercentage: "%15"), "0.1500")
    }

    func testTheEdgesAreAccepted() {
        XCTAssertEqual(AgenciesModel.rate(fromPercentage: "0"), "0.0000")
        XCTAssertEqual(AgenciesModel.rate(fromPercentage: "100"), "1.0000")
    }

    /// Above a hundred per cent is not a commission, it is a typo.
    func testOutOfRangeIsRefused() {
        XCTAssertNil(AgenciesModel.rate(fromPercentage: "150"))
        XCTAssertNil(AgenciesModel.rate(fromPercentage: "-5"))
    }

    /// Empty means "no rate agreed", which is different from zero.
    func testEmptyIsNil() {
        XCTAssertNil(AgenciesModel.rate(fromPercentage: ""))
        XCTAssertNil(AgenciesModel.rate(fromPercentage: "   "))
        XCTAssertNil(AgenciesModel.rate(fromPercentage: "onda bir"))
    }
}
