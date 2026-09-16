package xyz.klinik.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.max

/**
 * The five ways a clinical screen can feel about something.
 *
 * A tone is a colour *and* a word: a caller picks `Critical` and gets the red
 * and the surface behind it together, and there is no way to reach for one
 * without the other. The names match the iOS `Tone`, because the two clients
 * are meant to look like one product.
 */
enum class Tone(val foreground: String, val surface: String) {
    Neutral("textSecondary", "surface"),
    Info("info", "infoSurface"),
    Success("success", "successSurface"),
    Warning("warning", "warningSurface"),
    Critical("critical", "criticalSurface"),
}

/**
 * The surface everything on a dense screen sits on.
 *
 * One card is one thing, and the eye can skip a whole card without reading it.
 * A doctor's screen carries more than a patient's, and the spec allows that as
 * long as the hierarchy is legible (section 7); cards are how it is drawn.
 */
@Composable
fun KlinikCard(
    modifier: Modifier = Modifier,
    tone: Tone = Tone.Neutral,
    content: @Composable ColumnScope.() -> Unit,
) {
    val background = if (tone == Tone.Neutral) {
        klinikColor("surfaceRaised")
    } else {
        klinikColor(tone.surface)
    }
    val border = if (tone == Tone.Neutral) {
        klinikColor("border")
    } else {
        klinikColor(tone.foreground).copy(alpha = 0.35f)
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(background, RoundedCornerShape(Tokens.Radius.lg))
            .border(
                width = if (tone == Tone.Neutral) 1.dp else 1.5.dp,
                color = border,
                shape = RoundedCornerShape(Tokens.Radius.lg),
            )
            .padding(Tokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
        content = content,
    )
}

/**
 * A small pill: a status, a count, a category.
 *
 * It wraps rather than truncating. A pill cut to "Komplikasyo…" has dropped
 * the word, and the word is what carries the state to somebody who cannot tell
 * the colours apart (spec section 7).
 */
@Composable
fun Badge(text: String, modifier: Modifier = Modifier, tone: Tone = Tone.Neutral) {
    Text(
        text,
        modifier = modifier
            .background(klinikColor(tone.surface), RoundedCornerShape(Tokens.Radius.pill))
            .border(
                1.dp,
                klinikColor(tone.foreground).copy(alpha = 0.3f),
                RoundedCornerShape(Tokens.Radius.pill),
            )
            .padding(horizontal = Tokens.Spacing.sm, vertical = Tokens.Spacing.xxs),
        color = klinikColor(tone.foreground),
        fontSize = Tokens.Typography.footnote.size,
        lineHeight = Tokens.Typography.footnote.lineHeight,
    )
}

/**
 * One number, large, with the word for what it counts.
 *
 * The number is the point, so it is the biggest thing in the tile; the label
 * under it is what stops the number being a riddle.
 */
@Composable
fun StatTile(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
    tone: Tone = Tone.Neutral,
) {
    Column(
        modifier = modifier
            .background(
                if (tone == Tone.Neutral) klinikColor("surface") else klinikColor(tone.surface),
                RoundedCornerShape(Tokens.Radius.md),
            )
            .padding(Tokens.Spacing.md)
            .heightIn(min = 92.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xs),
    ) {
        Text(
            value,
            color = if (tone == Tone.Neutral) {
                klinikColor("textPrimary")
            } else {
                klinikColor(tone.foreground)
            },
            fontSize = Tokens.Typography.title.size,
            lineHeight = Tokens.Typography.title.lineHeight,
            fontWeight = Tokens.Typography.title.weight,
        )
        Text(
            label,
            color = klinikColor("textSecondary"),
            fontSize = Tokens.Typography.caption.size,
            lineHeight = Tokens.Typography.caption.lineHeight,
        )
    }
}

/** A heading over a group of cards, with an optional line under it. */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, subtitle: String? = null) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
    ) {
        Text(
            title,
            color = klinikColor("textPrimary"),
            fontSize = Tokens.Typography.heading.size,
            lineHeight = Tokens.Typography.heading.lineHeight,
            fontWeight = Tokens.Typography.heading.weight,
        )
        subtitle?.let {
            Text(
                it,
                color = klinikColor("textSecondary"),
                fontSize = Tokens.Typography.caption.size,
                lineHeight = Tokens.Typography.caption.lineHeight,
            )
        }
    }
}

/**
 * Initials in a circle, where a photograph would be.
 *
 * The clinic has photographs of surgical sites and none of faces. Decorative:
 * the name is written beside it on every screen that uses this, and a screen
 * reader that announced both would read the row twice.
 */
@Composable
fun InitialsAvatar(name: String, modifier: Modifier = Modifier, diameter: Dp = 44.dp) {
    Box(
        modifier = modifier
            .size(diameter)
            .background(klinikColor("infoSurface"), CircleShape)
            .clearAndSetSemantics { },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initialsOf(name),
            color = klinikColor("accent"),
            fontSize = Tokens.Typography.subheading.size,
            fontWeight = Tokens.Typography.subheading.weight,
        )
    }
}

/**
 * First letter of the first two words.
 *
 * `uppercase()` with the default locale, so a Turkish "i" becomes "İ" on a
 * Turkish phone rather than the "I" an invariant uppercase would give.
 */
fun initialsOf(name: String): String =
    name.split(" ").filter { it.isNotBlank() }.take(2).map { it.first() }.joinToString("").uppercase()

/**
 * A row of small things that moves onto the next line rather than squeezing.
 *
 * Badges are pills, and a pill has a natural width. Put three in a `Row` and
 * each is offered a third of the screen; at the largest accessibility font
 * scales a third of a screen is narrower than the word inside, and the word
 * wraps one letter per line. Here each child is measured unconstrained and
 * given exactly what it asked for.
 */
@Composable
fun FlowRow(
    modifier: Modifier = Modifier,
    horizontalSpacing: Dp = Tokens.Spacing.sm,
    verticalSpacing: Dp = Tokens.Spacing.xs,
    content: @Composable () -> Unit,
) {
    Layout(content = content, modifier = modifier) { measurables, constraints ->
        val gapX = horizontalSpacing.roundToPx()
        val gapY = verticalSpacing.roundToPx()
        val maxWidth = constraints.maxWidth

        val placeables = measurables.map { it.measure(constraints.copy(minWidth = 0)) }

        var x = 0
        var y = 0
        var rowHeight = 0
        var widest = 0
        val positions = mutableListOf<Pair<Int, Int>>()

        for (placeable in placeables) {
            if (x > 0 && x + placeable.width > maxWidth) {
                y += rowHeight + gapY
                x = 0
                rowHeight = 0
            }

            positions += x to y
            x += placeable.width + gapX
            widest = max(widest, x - gapX)
            rowHeight = max(rowHeight, placeable.height)
        }

        layout(width = widest.coerceIn(constraints.minWidth, maxWidth), height = y + rowHeight) {
            placeables.forEachIndexed { index, placeable ->
                val (left, top) = positions[index]
                placeable.place(left, top)
            }
        }
    }
}

/**
 * A row that leads somewhere and says what is waiting there.
 *
 * "Tahliller" tells a doctor nothing; "Tahliller · 2 bekliyor" tells them
 * whether to tap. The count is why this exists.
 */
@Composable
fun NavigationRow(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    detail: String? = null,
    badge: String? = null,
    badgeTone: Tone = Tone.Neutral,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .heightIn(min = Tokens.minimumTouchTarget)
            .padding(vertical = Tokens.Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.md),
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.xxs),
        ) {
            Text(
                title,
                color = klinikColor("textPrimary"),
                fontSize = Tokens.Typography.subheading.size,
                fontWeight = Tokens.Typography.subheading.weight,
            )
            detail?.let {
                Text(
                    it,
                    color = klinikColor("textSecondary"),
                    fontSize = Tokens.Typography.caption.size,
                    lineHeight = Tokens.Typography.caption.lineHeight,
                )
            }
        }

        badge?.let { Badge(it, tone = badgeTone) }
    }
}

/** A row that becomes a column when the words stop fitting. */
@Composable
fun AdaptiveStack(
    stacked: Boolean,
    modifier: Modifier = Modifier,
    spacing: Dp = Tokens.Spacing.md,
    content: @Composable () -> Unit,
) {
    if (stacked) {
        Column(
            modifier = modifier,
            verticalArrangement = Arrangement.spacedBy(spacing),
        ) { content() }
    } else {
        Row(
            modifier = modifier,
            horizontalArrangement = Arrangement.spacedBy(spacing),
            verticalAlignment = Alignment.Top,
        ) { content() }
    }
}
