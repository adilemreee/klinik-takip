package xyz.klinik.shell

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The documents this parser exists for are clinical ones.
 *
 * A consent form or a lab interpretation that renders as one run-on line is a
 * document nobody can read, and the failure looks exactly like a document that
 * happens to be badly written — so the structure is held to here rather than
 * being noticed on a device.
 */
class MarkdownTest {
    @Test
    fun `a heading and the paragraph under it stay apart`() {
        val blocks = markdownBlocks("## Bulgular\nHemogram normal sınırlarda.")

        assertEquals(
            listOf(
                MarkdownBlock.Heading(2, "Bulgular"),
                MarkdownBlock.Paragraph("Hemogram normal sınırlarda."),
            ),
            blocks,
        )
    }

    /** Wrapped lines are one paragraph; a blank line ends it. */
    @Test
    fun `wrapped lines join and a blank line separates`() {
        val blocks = markdownBlocks("Birinci satır\nikinci satır\n\nAyrı paragraf")

        assertEquals(
            listOf(
                MarkdownBlock.Paragraph("Birinci satır ikinci satır"),
                MarkdownBlock.Paragraph("Ayrı paragraf"),
            ),
            blocks,
        )
    }

    @Test
    fun `bulleted and numbered lists do not merge`() {
        val blocks = markdownBlocks("- bir\n- iki\n1. üç\n2. dört")

        assertEquals(
            listOf(
                MarkdownBlock.Listing(listOf("bir", "iki"), ordered = false),
                MarkdownBlock.Listing(listOf("üç", "dört"), ordered = true),
            ),
            blocks,
        )
    }

    /**
     * The `|---|` row says the row above it was a header; it is not a row of
     * data, and drawing it puts a line of dashes in a clinical table.
     */
    @Test
    fun `a table keeps its cells and drops the divider`() {
        val blocks = markdownBlocks(
            """
            | Tetkik | Sonuç |
            |---|---|
            | Hgb | 13.4 |
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                MarkdownBlock.Table(
                    listOf(listOf("Tetkik", "Sonuç"), listOf("Hgb", "13.4")),
                ),
            ),
            blocks,
        )
    }

    @Test
    fun `a quote is its own block`() {
        val blocks = markdownBlocks("> Hasta ağrı tarif ediyor.\n\nDevam.")

        assertEquals(MarkdownBlock.Quote("Hasta ağrı tarif ediyor."), blocks.first())
    }

    /** A note to whoever maintains the document, not to whoever reads it. */
    @Test
    fun `an html comment is not shown`() {
        val blocks = markdownBlocks("<!-- şablon sürümü 3 -->\nMetin")

        assertEquals(listOf(MarkdownBlock.Paragraph("Metin")), blocks)
    }

    @Test
    fun `a rule is not a list of dashes`() {
        val blocks = markdownBlocks("Üst\n\n---\n\nAlt")

        assertEquals(MarkdownBlock.Rule, blocks[1])
    }

    /**
     * Where the text is read rather than drawn, the marks are noise a reader
     * has to see past.
     */
    @Test
    fun `plain text drops the marks and keeps the words`() {
        val plain = markdownPlainText("## Özet\n**Kritik** bulgu yok.\n- `Hgb` normal")

        assertTrue(plain.startsWith("Özet"), plain)
        assertTrue("Kritik bulgu yok." in plain, plain)
        assertTrue("Hgb normal" in plain, plain)
    }
}
