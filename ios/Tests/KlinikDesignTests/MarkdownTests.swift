import XCTest
@testable import KlinikDesign

/**
 * Markdown that fails to parse.
 *
 * The rule: a string that cannot be parsed is shown verbatim. Losing a
 * clinician's report to a stray asterisk would be worse than showing them a
 * stray asterisk.
 */
final class MarkdownTests: XCTestCase {
    func testABrokenStringIsStillShown() {
        let mangled = "**unclosed"

        XCTAssertFalse(String(Markdown.attributed(mangled).characters).isEmpty)
    }

    func testHeadingsAndBulletsSurvive() {
        let source = "# Başlık\n\n- bir\n- iki"
        let rendered = String(Markdown.attributed(source).characters)

        XCTAssertTrue(rendered.contains("Başlık"))
        XCTAssertTrue(rendered.contains("bir"))
        XCTAssertTrue(rendered.contains("iki"))
    }
}
