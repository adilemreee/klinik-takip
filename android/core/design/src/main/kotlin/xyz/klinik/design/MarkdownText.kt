package xyz.klinik.design

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import xyz.klinik.shell.MarkdownBlock
import xyz.klinik.shell.markdownBlocks
import androidx.compose.foundation.background
import androidx.compose.material3.Text

/**
 * A clinical document, drawn.
 *
 * The parser is in `core:shell`; this only decides what each block looks like.
 * Small on purpose — the clinic's consent forms and the AI layer's reports use
 * headings, paragraphs, lists and pipe tables, and nothing here invents more
 * structure than the document has.
 */
@Composable
fun MarkdownText(source: String, modifier: Modifier = Modifier) {
    val blocks = remember(source) { markdownBlocks(source) }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
    ) {
        blocks.forEach { block -> MarkdownBlockView(block) }
    }
}

@Composable
private fun MarkdownBlockView(block: MarkdownBlock) {
    when (block) {
        is MarkdownBlock.Heading -> Text(
            text = inline(block.text),
            fontSize = headingSize(block.level).size,
            fontWeight = headingSize(block.level).weight,
            lineHeight = headingSize(block.level).lineHeight,
            color = klinikColor("textPrimary"),
        )

        is MarkdownBlock.Paragraph -> Text(
            text = inline(block.text),
            fontSize = Tokens.Typography.body.size,
            lineHeight = Tokens.Typography.body.lineHeight,
            color = klinikColor("textPrimary"),
        )

        // Indented and marked down the side, because a quote in these documents
        // is usually the patient's own words and attributing them to the clinic
        // would be a different sentence.
        is MarkdownBlock.Quote -> Row(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier
                    .width(Tokens.Spacing.xs)
                    .height(Tokens.Spacing.xxl)
                    .background(klinikColor("border")),
            ) {}

            Text(
                text = inline(block.text),
                fontSize = Tokens.Typography.body.size,
                lineHeight = Tokens.Typography.body.lineHeight,
                fontStyle = FontStyle.Italic,
                color = klinikColor("textSecondary"),
                modifier = Modifier.padding(start = Tokens.Spacing.sm),
            )
        }

        is MarkdownBlock.Listing -> Column(
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
        ) {
            block.items.forEachIndexed { index, item ->
                Row(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = if (block.ordered) "${index + 1}." else "•",
                        fontSize = Tokens.Typography.body.size,
                        color = klinikColor("textSecondary"),
                        modifier = Modifier.padding(end = Tokens.Spacing.sm),
                    )
                    Text(
                        text = inline(item),
                        fontSize = Tokens.Typography.body.size,
                        lineHeight = Tokens.Typography.body.lineHeight,
                        color = klinikColor("textPrimary"),
                    )
                }
            }
        }

        is MarkdownBlock.Table -> MarkdownTable(block.rows)

        MarkdownBlock.Rule -> Column(
            modifier = Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(klinikColor("border")),
        ) {}
    }
}

/**
 * A pipe table.
 *
 * Two columns are drawn as label-and-value rows rather than as a grid: that is
 * what a two-column table in these documents always is, and it survives the
 * largest font scale, which a grid on a phone does not. Anything wider keeps
 * its shape and scrolls sideways — a clinical table squeezed to fit is a table
 * that has been altered.
 */
@Composable
private fun MarkdownTable(rows: List<List<String>>) {
    if (rows.isEmpty()) return

    if (rows.all { it.size <= 2 }) {
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs)) {
            rows.forEach { row ->
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = inline(row.firstOrNull().orEmpty()),
                        fontSize = Tokens.Typography.caption.size,
                        color = klinikColor("textSecondary"),
                    )
                    Text(
                        text = inline(row.getOrNull(1).orEmpty()),
                        fontSize = Tokens.Typography.body.size,
                        color = klinikColor("textPrimary"),
                    )
                }
            }
        }

        return
    }

    val scroll = rememberScrollState()

    Column(
        modifier = Modifier.fillMaxWidth().horizontalScroll(scroll),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
    ) {
        rows.forEachIndexed { index, row ->
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.lg)) {
                row.forEach { cell ->
                    Text(
                        text = inline(cell),
                        fontSize = Tokens.Typography.body.size,
                        // The first row is the header when the source had one.
                        fontWeight = if (index == 0) FontWeight.SemiBold else FontWeight.Normal,
                        color = klinikColor("textPrimary"),
                    )
                }
            }
        }
    }
}

private fun headingSize(level: Int): Tokens.TypeStyle = when (level) {
    1 -> Tokens.Typography.title
    2 -> Tokens.Typography.heading
    else -> Tokens.Typography.subheading
}

/**
 * `**bold**`, `*italic*` and `` `code` ``, and nothing else.
 *
 * An unmatched marker is left as written rather than swallowing the rest of the
 * line: a lone asterisk in a dose ("5*2") is text, not the beginning of
 * emphasis that never ends.
 */
@Composable
private fun inline(source: String): AnnotatedString {
    val strong = klinikColor("textPrimary")
    val code = klinikColor("textSecondary")

    return remember(source, strong, code) { annotate(source, strong, code) }
}

private fun annotate(source: String, strong: Color, code: Color): AnnotatedString =
    buildAnnotatedString {
        var index = 0

        while (index < source.length) {
            val marker = markerAt(source, index)

            if (marker == null) {
                append(source[index])
                index++
                continue
            }

            val close = source.indexOf(marker.token, startIndex = index + marker.token.length)

            if (close < 0) {
                // Unmatched: the marker is text.
                append(source, index, index + marker.token.length)
                index += marker.token.length
                continue
            }

            val inner = source.substring(index + marker.token.length, close)

            withStyle(marker.style(strong, code)) { append(inner) }
            index = close + marker.token.length
        }
    }

private class InlineMarker(val token: String, val style: (Color, Color) -> SpanStyle)

private fun markerAt(source: String, index: Int): InlineMarker? = when {
    source.startsWith("**", index) ->
        InlineMarker("**") { strong, _ -> SpanStyle(fontWeight = FontWeight.Bold, color = strong) }

    source.startsWith("`", index) ->
        InlineMarker("`") { _, muted -> SpanStyle(color = muted) }

    source.startsWith("*", index) ->
        InlineMarker("*") { strong, _ -> SpanStyle(fontStyle = FontStyle.Italic, color = strong) }

    else -> null
}
