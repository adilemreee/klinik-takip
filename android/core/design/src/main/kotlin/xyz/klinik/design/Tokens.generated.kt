// Generated from design/tokens.json — do not edit.
// Regenerate with: node design/scripts/generate-tokens.mjs
package xyz.klinik.design

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/** Design tokens shared with the iOS client. */
object Tokens {
    /** The smallest tappable area (spec section 7). */
    val minimumTouchTarget: Dp = 44.dp

    object Spacing {
        val xxs: Dp = 2.dp
        val xs: Dp = 4.dp
        val sm: Dp = 8.dp
        val md: Dp = 12.dp
        val lg: Dp = 16.dp
        val xl: Dp = 24.dp
        val xxl: Dp = 32.dp
        val xxxl: Dp = 48.dp
    }

    object Radius {
        val sm: Dp = 6.dp
        val md: Dp = 10.dp
        val lg: Dp = 16.dp
        val pill: Dp = 999.dp
    }

    object LightPalette {
        val background = Color(0xFFFFFFFF)
        val surface = Color(0xFFF5F6F8)
        val surfaceRaised = Color(0xFFFFFFFF)
        val border = Color(0xFFD8DCE3)
        val textPrimary = Color(0xFF111418)
        val textSecondary = Color(0xFF4A5361)
        val textDisabled = Color(0xFF8A93A0)
        val accent = Color(0xFF0B5FB0)
        val accentText = Color(0xFFFFFFFF)
        val critical = Color(0xFFB3261E)
        val criticalSurface = Color(0xFFFCEEEC)
        val warning = Color(0xFF8A5300)
        val warningSurface = Color(0xFFFFF4E3)
        val success = Color(0xFF0F6B45)
        val successSurface = Color(0xFFE8F5EE)
        val info = Color(0xFF0B5FB0)
        val infoSurface = Color(0xFFE8F1FA)
    }

    object DarkPalette {
        val background = Color(0xFF0E1116)
        val surface = Color(0xFF161A21)
        val surfaceRaised = Color(0xFF1E242D)
        val border = Color(0xFF333B46)
        val textPrimary = Color(0xFFF2F4F7)
        val textSecondary = Color(0xFFB3BCC9)
        val textDisabled = Color(0xFF6C7684)
        val accent = Color(0xFF7DB5F0)
        val accentText = Color(0xFF0E1116)
        val critical = Color(0xFFF2B8B5)
        val criticalSurface = Color(0xFF3B1F1D)
        val warning = Color(0xFFF5C87A)
        val warningSurface = Color(0xFF3A2A0E)
        val success = Color(0xFF7FD1A8)
        val successSurface = Color(0xFF12301F)
        val info = Color(0xFF7DB5F0)
        val infoSurface = Color(0xFF132435)
    }

    data class TypeStyle(val size: TextUnit, val weight: FontWeight, val lineHeight: TextUnit)

    object Typography {
        val display = TypeStyle(34.sp, FontWeight.Bold, 41.sp)
        val title = TypeStyle(28.sp, FontWeight.Bold, 34.sp)
        val heading = TypeStyle(22.sp, FontWeight.SemiBold, 28.sp)
        val subheading = TypeStyle(17.sp, FontWeight.SemiBold, 22.sp)
        val body = TypeStyle(17.sp, FontWeight.Normal, 22.sp)
        val callout = TypeStyle(16.sp, FontWeight.Normal, 21.sp)
        val caption = TypeStyle(13.sp, FontWeight.Normal, 18.sp)
        val footnote = TypeStyle(12.sp, FontWeight.Normal, 16.sp)
    }

    /** A clinical state is a colour *and* an icon (spec section 7). */
    data class ClinicalState(val colorName: String, val iconName: String)

    object State {
        val labNormal = ClinicalState("success", "checkmark.circle")
        val labLow = ClinicalState("warning", "arrow.down.circle")
        val labHigh = ClinicalState("warning", "arrow.up.circle")
        val labCritical = ClinicalState("critical", "exclamationmark.triangle.fill")
        val triageInfo = ClinicalState("info", "info.circle")
        val triageRoutine = ClinicalState("success", "clock")
        val triageUrgent = ClinicalState("warning", "exclamationmark.circle")
        val triageEmergency = ClinicalState("critical", "exclamationmark.triangle.fill")
    }
}

/** Resolves a palette colour for the current colour scheme. */
@Composable
@ReadOnlyComposable
fun klinikColor(name: String): Color {
    val palette = if (isSystemInDarkTheme()) darkColors else lightColors
    return palette[name] ?: Color.Unspecified
}

private val lightColors: Map<String, Color> = mapOf(
    "background" to Tokens.LightPalette.background,
    "surface" to Tokens.LightPalette.surface,
    "surfaceRaised" to Tokens.LightPalette.surfaceRaised,
    "border" to Tokens.LightPalette.border,
    "textPrimary" to Tokens.LightPalette.textPrimary,
    "textSecondary" to Tokens.LightPalette.textSecondary,
    "textDisabled" to Tokens.LightPalette.textDisabled,
    "accent" to Tokens.LightPalette.accent,
    "accentText" to Tokens.LightPalette.accentText,
    "critical" to Tokens.LightPalette.critical,
    "criticalSurface" to Tokens.LightPalette.criticalSurface,
    "warning" to Tokens.LightPalette.warning,
    "warningSurface" to Tokens.LightPalette.warningSurface,
    "success" to Tokens.LightPalette.success,
    "successSurface" to Tokens.LightPalette.successSurface,
    "info" to Tokens.LightPalette.info,
    "infoSurface" to Tokens.LightPalette.infoSurface,
)

private val darkColors: Map<String, Color> = mapOf(
    "background" to Tokens.DarkPalette.background,
    "surface" to Tokens.DarkPalette.surface,
    "surfaceRaised" to Tokens.DarkPalette.surfaceRaised,
    "border" to Tokens.DarkPalette.border,
    "textPrimary" to Tokens.DarkPalette.textPrimary,
    "textSecondary" to Tokens.DarkPalette.textSecondary,
    "textDisabled" to Tokens.DarkPalette.textDisabled,
    "accent" to Tokens.DarkPalette.accent,
    "accentText" to Tokens.DarkPalette.accentText,
    "critical" to Tokens.DarkPalette.critical,
    "criticalSurface" to Tokens.DarkPalette.criticalSurface,
    "warning" to Tokens.DarkPalette.warning,
    "warningSurface" to Tokens.DarkPalette.warningSurface,
    "success" to Tokens.DarkPalette.success,
    "successSurface" to Tokens.DarkPalette.successSurface,
    "info" to Tokens.DarkPalette.info,
    "infoSurface" to Tokens.DarkPalette.infoSurface,
)
