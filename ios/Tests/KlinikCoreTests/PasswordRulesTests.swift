import XCTest
@testable import KlinikCore

/**
 * What the server will accept as a password, mirrored.
 *
 * Mirrored rather than guessed at: somebody choosing a password is told before
 * they submit, and a rejection arriving from the network on a form they have
 * just filled in twice reads as the app being broken. The server stays the
 * authority — it also refuses common passwords, which this cannot see.
 */
final class PasswordRulesTests: XCTestCase {
    func testAShortPasswordIsRefused() {
        XCTAssertFalse(PasswordRules.looksAcceptable("kisa1"))
        XCTAssertFalse(PasswordRules.problems(with: "kisa1").isEmpty)
    }

    /// Length alone is not a password. Both rules, not either.
    func testLettersWithoutNumbersAreRefused() {
        XCTAssertFalse(PasswordRules.looksAcceptable("yalnizcaharfler"))
        XCTAssertFalse(PasswordRules.looksAcceptable("123456789012345"))
    }

    func testAReasonablePasswordPasses() {
        XCTAssertTrue(PasswordRules.looksAcceptable("otel4kirmizi9lamba"))
    }

    /**
     * A password containing the address it is for.
     *
     * Guessable by anyone who knows the person, which in a clinic is a large
     * set of people — and the one piece of personal data the form already has
     * in front of it.
     */
    func testItRefusesAPasswordContainingTheIdentifier() {
        // The whole identifier, which is what the server looks for: it is
        // handed the address as one string and asks whether the password
        // contains it.
        XCTAssertFalse(
            PasswordRules.looksAcceptable(
                "1ayse@klinik.test2",
                identifier: "ayse@klinik.test"
            )
        )

        XCTAssertFalse(
            PasswordRules.looksAcceptable("Ayse1234yilmaz", identifier: "ayse"),
            "the comparison is not case sensitive"
        )

        // And the local part alone is not the rule — matching the server
        // rather than being stricter than it, because a client that refuses
        // what the server would accept is a client nobody can get past.
        XCTAssertTrue(
            PasswordRules.looksAcceptable("ayse1234yilmazlar", identifier: "ayse@klinik.test")
        )
    }

    /// Something too short to be identifying is not worth refusing over.
    func testAVeryShortIdentifierIsNotUsedAsARule() {
        XCTAssertTrue(PasswordRules.looksAcceptable("abc4kirmizi9lamba", identifier: "ab"))
    }

    /// With nothing typed the list reads as the requirements rather than as
    /// complaints, which is what the form shows before anybody starts.
    func testAnEmptyPasswordListsEveryRule() {
        XCTAssertEqual(PasswordRules.problems(with: "").count, 2)
    }

    /// Every rule is a sentence somebody can read, not a key.
    func testEveryRuleIsTranslated() {
        for rule in PasswordRules.problems(with: "") {
            XCTAssertFalse(rule.isEmpty)
            XCTAssertFalse(rule.hasPrefix("password.rule."), "untranslated: \(rule)")
        }
    }
}
