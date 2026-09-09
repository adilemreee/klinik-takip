import XCTest
import KlinikCore
@testable import KlinikProtocolsFeature

/**
 * The one judgement this screen makes before the server sees anything.
 *
 * The floor on length is not fussiness: a document shorter than a sentence
 * produces a single passage that matches every question weakly, which is how a
 * retrieval assistant ends up quoting a heading at somebody asking about
 * bleeding.
 */
final class ProtocolsModelTests: XCTestCase {
    private let realDocument = """
    Ameliyattan sonraki ilk 48 saat boyunca duş almayın. Pansumanınız ıslanırsa
    kliniği arayın.
    """

    func testATitleIsRequired() {
        XCTAssertNotNil(ProtocolsModel.problem(title: "", content: realDocument))
        XCTAssertNotNil(ProtocolsModel.problem(title: "   ", content: realDocument))
        XCTAssertNil(ProtocolsModel.problem(title: "Taburculuk", content: realDocument))
    }

    func testAOneLineDocumentIsRefused() {
        XCTAssertNotNil(ProtocolsModel.problem(title: "Duş", content: "Duş almayın."))
        XCTAssertNotNil(ProtocolsModel.problem(title: "Duş", content: ""))
    }

    /// Whitespace does not count towards the floor.
    func testPaddingDoesNotMakeADocumentLongEnough() {
        let padded = "Kısa." + String(repeating: " ", count: 200)

        XCTAssertNotNil(ProtocolsModel.problem(title: "Kısa", content: padded))
    }
}
