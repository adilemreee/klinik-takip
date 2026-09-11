import XCTest
@testable import KlinikDesign

/**
 * Markdown, as blocks.
 *
 * The rule the old version of this file missed: it asserted only that the
 * *characters* survived, which they did — through a renderer that put a
 * heading, three paragraphs and a bullet list on one line. A consent form
 * rendered that way is a wall somebody scrolls past, and the test said it was
 * fine.
 */
final class MarkdownTests: XCTestCase {
    func testABrokenStringIsStillShown() {
        let mangled = "**unclosed"

        XCTAssertFalse(String(Markdown.attributed(mangled).characters).isEmpty)
    }

    /// The one that matters. Four blocks in, four blocks out — not one.
    func testAHeadingAndItsParagraphDoNotBecomeOneBlock() {
        let blocks = Markdown.blocks(in: "# Başlık\n\nBir cümle.\n\n- bir\n- iki")

        XCTAssertEqual(blocks.count, 3)
        XCTAssertEqual(blocks[0].kind, .heading(level: 1, text: "Başlık"))
        XCTAssertEqual(blocks[1].kind, .paragraph("Bir cümle."))
        XCTAssertEqual(blocks[2].kind, .list(items: ["bir", "iki"], ordered: false))
    }

    func testHeadingLevelsAreKept() {
        let blocks = Markdown.blocks(in: "## İkinci\n\n### Üçüncü")

        XCTAssertEqual(blocks[0].kind, .heading(level: 2, text: "İkinci"))
        XCTAssertEqual(blocks[1].kind, .heading(level: 3, text: "Üçüncü"))
    }

    /// Lines inside one paragraph are joined; a blank line starts a new one.
    /// Source wrapped at eighty columns must not render as a column of
    /// fragments.
    func testWrappedLinesRejoinAndBlankLinesSeparate() {
        let blocks = Markdown.blocks(in: "bir satır\ndevamı\n\nayrı paragraf")

        XCTAssertEqual(blocks.count, 2)
        XCTAssertEqual(blocks[0].kind, .paragraph("bir satır devamı"))
        XCTAssertEqual(blocks[1].kind, .paragraph("ayrı paragraf"))
    }

    func testNumberedAndBulletedListsAreDifferent() {
        let blocks = Markdown.blocks(in: "1. bir\n2. iki\n\n- a\n- b")

        XCTAssertEqual(blocks[0].kind, .list(items: ["bir", "iki"], ordered: true))
        XCTAssertEqual(blocks[1].kind, .list(items: ["a", "b"], ordered: false))
    }

    /**
     * The consent form's table.
     *
     * `AttributedString` renders a pipe table as its own punctuation, which on
     * the most legally sensitive screen in the app meant the planned operation
     * and the operating surgeon arrived as a row of vertical bars.
     */
    func testAPipeTableBecomesRows() {
        let source = """
        | | |
        |---|---|
        | Planlanan işlem | **Meme büyütme** |
        | Hekim | Dr. A |
        """

        let blocks = Markdown.blocks(in: source)

        XCTAssertEqual(
            blocks.first?.kind,
            .table(rows: [
                ["", ""],
                ["Planlanan işlem", "**Meme büyütme**"],
                ["Hekim", "Dr. A"],
            ])
        )
    }

    func testBlockQuotesAreTheirOwnBlock() {
        let blocks = Markdown.blocks(in: "> bir uyarı\n\ndüz metin")

        XCTAssertEqual(blocks[0].kind, .quote("bir uyarı"))
        XCTAssertEqual(blocks[1].kind, .paragraph("düz metin"))
    }

    /// The marker in the consent document tells the *server* where the patient
    /// section starts. Showing it to the patient would be showing them the
    /// clinic's own bookkeeping.
    func testHtmlCommentsAreNotShown() {
        let blocks = Markdown.blocks(in: "<!-- ONAM-BASLANGIC -->\n\nMetin")

        XCTAssertEqual(blocks.count, 1)
        XCTAssertEqual(blocks[0].kind, .paragraph("Metin"))
    }

    func testHorizontalRulesSurvive() {
        let blocks = Markdown.blocks(in: "üst\n\n---\n\nalt")

        XCTAssertEqual(blocks.count, 3)
        XCTAssertEqual(blocks[1].kind, .rule)
    }

    /// Inline markup is still `AttributedString`'s job, and still works.
    func testInlineEmphasisIsParsedAndItsMarkersRemoved() {
        let rendered = String(Markdown.attributed("**kalın** ve normal").characters)

        XCTAssertEqual(rendered, "kalın ve normal")
    }

    /// An empty document is an empty document, not one empty paragraph.
    func testNothingInNothingOut() {
        XCTAssertTrue(Markdown.blocks(in: "").isEmpty)
        XCTAssertTrue(Markdown.blocks(in: "\n\n  \n").isEmpty)
    }
}
