import XCTest
import KlinikCore
@testable import KlinikAPI

/**
 * The interaction check, as the clinician's screen sees it (spec M5, T6.2).
 *
 * The property that matters on this screen: an empty warning list next to
 * unrecognised drugs is not a clean bill of health, and reading it as one is how
 * software misleads somebody into thinking a combination is safe.
 */
final class InteractionsAPITests: XCTestCase {
    private func decode(_ json: String) throws -> InteractionCheck {
        try JSONDecoder.klinik.decode(InteractionCheck.self, from: Data(json.utf8))
    }

    func testSaysWhenNothingWasActuallyChecked() throws {
        let check = try decode(
            #"""
            {"warnings":[],"unrecognised":[
              {"id":"m1","drugName":"Bilinmeyen A"},{"id":"m2","drugName":"Bilinmeyen B"}],
             "comparedPairs":0}
            """#
        )

        XCTAssertTrue(check.warnings.isEmpty)
        // The screen must not read this as "no interactions".
        XCTAssertFalse(check.checkedAnything)
        XCTAssertEqual(check.unrecognised.count, 2)
    }

    func testTellsApartNothingFoundFromNothingChecked() throws {
        let checked = try decode(#"{"warnings":[],"unrecognised":[],"comparedPairs":3}"#)

        XCTAssertTrue(checked.warnings.isEmpty)
        XCTAssertTrue(checked.checkedAnything)
        XCTAssertTrue(checked.unrecognised.isEmpty)
    }

    func testReadsAWarningWithTheDrugsAsWritten() throws {
        let check = try decode(
            #"""
            {"warnings":[{"severity":"MAJOR","note":"Kanama riski artar.",
              "ingredients":["warfarin","acetylsalicylic-acid"],
              "between":[{"id":"m1","drugName":"Coumadin 5mg"},
                         {"id":"m2","drugName":"Coraspin 100mg"}]}],
             "unrecognised":[],"comparedPairs":1}
            """#
        )

        XCTAssertTrue(check.checkedAnything)
        XCTAssertTrue(check.hasSevere)
        XCTAssertEqual(
            check.warnings[0].between.map(\.drugName),
            ["Coumadin 5mg", "Coraspin 100mg"]
        )
        XCTAssertEqual(check.warnings[0].note, "Kanama riski artar.")
    }

    /** Interrupting on a minor interaction teaches people to dismiss the dialog. */
    func testOnlyTheSeriousOnesInterrupt() throws {
        XCTAssertTrue(InteractionSeverity.contraindicated.isSevere)
        XCTAssertTrue(InteractionSeverity.major.isSevere)
        XCTAssertFalse(InteractionSeverity.moderate.isSevere)
        XCTAssertFalse(InteractionSeverity.minor.isSevere)

        let minorOnly = try decode(
            #"""
            {"warnings":[{"severity":"MINOR","note":"Emilim azalabilir.",
              "ingredients":["levothyroxine","omeprazole"],
              "between":[{"id":"m1","drugName":"Euthyrox"},{"id":"m2","drugName":"Omeprazol"}]}],
             "unrecognised":[],"comparedPairs":1}
            """#
        )

        XCTAssertFalse(minorOnly.hasSevere)
    }

    func testHasAWordForEverySeverity() {
        for severity in InteractionSeverity.allCases {
            XCTAssertNotEqual(severity.localizedName, "interaction.severity.\(severity.rawValue)")
            XCTAssertFalse(severity.localizedName.isEmpty)
        }
    }

    /**
     * The warning the screen carries whatever the result: this table is a
     * starter set, and silence from it is not evidence.
     */
    func testCarriesTheCaveatThatSilenceIsNotSafety() {
        let caveat = L10n.string("interaction.disclaimer")

        XCTAssertNotEqual(caveat, "interaction.disclaimer")
        XCTAssertFalse(caveat.isEmpty)
    }
}
