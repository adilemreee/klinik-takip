package xyz.klinik.shell

/**
 * One piece of a document.
 *
 * Deliberately small: headings, paragraphs, quotes, bullet and numbered lists,
 * pipe tables and horizontal rules. That is what the clinic's documents and the
 * AI layer's reports actually contain, and a fuller parser would be more
 * surface than this needs.
 *
 * Mirrors the iOS `Markdown.Kind`.
 */
sealed interface MarkdownBlock {
    data class Heading(val level: Int, val text: String) : MarkdownBlock
    data class Paragraph(val text: String) : MarkdownBlock
    data class Quote(val text: String) : MarkdownBlock
    data class Listing(val items: List<String>, val ordered: Boolean) : MarkdownBlock

    /** Rows of cells, the first being the header when the source had one. */
    data class Table(val rows: List<List<String>>) : MarkdownBlock
    data object Rule : MarkdownBlock
}

/**
 * The document, split into blocks.
 *
 * Here rather than in the Compose module for the reason this module exists: a
 * consent form or a lab interpretation that renders as one run-on line is a
 * clinical document nobody can read, and that is a failure worth catching on a
 * laptop rather than on a device.
 */
fun markdownBlocks(source: String): List<MarkdownBlock> {
    val blocks = mutableListOf<MarkdownBlock>()
    val paragraph = mutableListOf<String>()
    val quote = mutableListOf<String>()
    val list = mutableListOf<String>()
    val table = mutableListOf<List<String>>()
    var ordered = false

    fun flushParagraph() {
        if (paragraph.isNotEmpty()) {
            blocks += MarkdownBlock.Paragraph(paragraph.joinToString(" "))
            paragraph.clear()
        }
    }

    fun flushQuote() {
        if (quote.isNotEmpty()) {
            blocks += MarkdownBlock.Quote(quote.joinToString(" "))
            quote.clear()
        }
    }

    fun flushList() {
        if (list.isNotEmpty()) {
            blocks += MarkdownBlock.Listing(list.toList(), ordered)
            list.clear()
        }
    }

    fun flushTable() {
        if (table.isNotEmpty()) {
            blocks += MarkdownBlock.Table(table.toList())
            table.clear()
        }
    }

    fun flushAll() {
        flushParagraph()
        flushQuote()
        flushList()
        flushTable()
    }

    for (rawLine in source.split("\n")) {
        val line = rawLine.trim()

        if (line.isEmpty()) {
            flushAll()
            continue
        }

        // An HTML comment is a note to whoever maintains the document, not to
        // whoever reads it.
        if (line.startsWith("<!--")) continue

        val heading = headingIn(line)
        if (heading != null) {
            flushAll()
            blocks += heading
            continue
        }

        if (isRule(line)) {
            flushAll()
            blocks += MarkdownBlock.Rule
            continue
        }

        val cells = tableCells(line)
        if (cells != null) {
            flushParagraph()
            flushQuote()
            flushList()

            // The `|---|---|` line under a header carries no content; it only
            // says the row above it was a header.
            if (!isTableDivider(cells)) table += cells
            continue
        }

        flushTable()

        if (line.startsWith(">")) {
            flushParagraph()
            flushList()
            quote += line.drop(1).trim()
            continue
        }

        val bullet = bulletIn(line)
        if (bullet != null) {
            flushParagraph()
            flushQuote()
            if (list.isNotEmpty() && ordered) flushList()
            ordered = false
            list += bullet
            continue
        }

        val numbered = numberedIn(line)
        if (numbered != null) {
            flushParagraph()
            flushQuote()
            if (list.isNotEmpty() && !ordered) flushList()
            ordered = true
            list += numbered
            continue
        }

        flushQuote()
        flushList()
        paragraph += line
    }

    flushAll()

    return blocks
}

/**
 * The inline marks stripped, leaving the words.
 *
 * The renderer draws emphasis itself; this is for the places a block's text is
 * read rather than drawn — a list row, a notification, a screen reader's
 * summary — where `**` is noise a reader has to see past.
 */
fun markdownPlainText(source: String): String =
    markdownBlocks(source).joinToString("\n") { block ->
        when (block) {
            is MarkdownBlock.Heading -> block.text
            is MarkdownBlock.Paragraph -> block.text
            is MarkdownBlock.Quote -> block.text
            is MarkdownBlock.Listing -> block.items.joinToString("\n")
            is MarkdownBlock.Table -> block.rows.joinToString("\n") { it.joinToString(" · ") }
            MarkdownBlock.Rule -> ""
        }
    }.replace(Regex("""\*{1,2}|_{1,2}|`"""), "").trim()

private fun headingIn(line: String): MarkdownBlock.Heading? {
    if (!line.startsWith("#")) return null

    val level = line.takeWhile { it == '#' }.length
    if (level > 6) return null

    val text = line.drop(level).trim()

    return if (text.isEmpty()) null else MarkdownBlock.Heading(level, text)
}

private fun isRule(line: String): Boolean {
    val stripped = line.replace(" ", "")

    return stripped.length >= 3 && (stripped.all { it == '-' } || stripped.all { it == '*' })
}

private fun bulletIn(line: String): String? {
    for (marker in listOf("- ", "* ", "+ ")) {
        if (line.startsWith(marker)) return line.drop(marker.length).trim()
    }

    // A marker on its own line is an empty item, not a paragraph beginning with
    // a dash.
    return if (line in listOf("-", "*", "+")) "" else null
}

private fun numberedIn(line: String): String? {
    val digits = line.takeWhile { it.isDigit() }
    if (digits.isEmpty()) return null

    val rest = line.drop(digits.length)

    return if (rest.startsWith(". ") || rest.startsWith(") ")) rest.drop(2).trim() else null
}

private fun tableCells(line: String): List<String>? {
    if (!line.startsWith("|")) return null

    var body = line
    if (body.endsWith("|")) body = body.dropLast(1)
    body = body.drop(1)

    return body.split("|").map { it.trim() }
}

private fun isTableDivider(cells: List<String>): Boolean =
    cells.isNotEmpty() && cells.all { cell ->
        cell.isNotEmpty() && cell.all { it == '-' || it == ':' }
    }
