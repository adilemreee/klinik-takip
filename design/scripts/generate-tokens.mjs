#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generates the design token sources for both platforms from tokens.json.
 *
 * Spec section 3.2 asks for shared tokens across iOS and Android. Sharing a
 * document that each platform then transcribes by hand is not sharing — the two
 * drift within a release. Generating both means they cannot.
 *
 * Output is deterministic and committed; CI regenerates and fails on any
 * difference, the same way the API contract is handled.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const tokens = JSON.parse(readFileSync(resolve(here, '../tokens.json'), 'utf8'));

const BANNER = [
  '// Generated from design/tokens.json — do not edit.',
  '// Regenerate with: node design/scripts/generate-tokens.mjs',
  '',
].join('\n');

const hexToComponents = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return { r: r.toFixed(4), g: g.toFixed(4), b: b.toFixed(4) };
};

const colorNames = Object.keys(tokens.color.light);
const typographyNames = Object.keys(tokens.typography).filter((k) => !k.startsWith('$'));
const semanticNames = Object.keys(tokens.semantic).filter((k) => !k.startsWith('$'));

// --- Swift -----------------------------------------------------------------

const swiftWeight = { regular: '.regular', semibold: '.semibold', bold: '.bold' };

const swift = `${BANNER}import SwiftUI

/// Design tokens shared with the Android client.
public enum Tokens {
    /// The smallest tappable area, in points (spec section 7).
    public static let minimumTouchTarget: CGFloat = ${tokens.meta.minimumTouchTargetPt}

    public enum Spacing {
${Object.entries(tokens.spacing)
  .map(([name, value]) => `        public static let ${name}: CGFloat = ${value}`)
  .join('\n')}
    }

    public enum Radius {
${Object.entries(tokens.radius)
  .map(([name, value]) => `        public static let ${name}: CGFloat = ${value}`)
  .join('\n')}
    }

    /// Each colour carries both schemes; a view resolves it from the
    /// environment. Kept in pure SwiftUI rather than bridging through UIColor,
    /// so the package builds and its tests run on any platform.
    public enum Palette {
${colorNames
  .map((name) => {
    const light = hexToComponents(tokens.color.light[name]);
    const dark = hexToComponents(tokens.color.dark[name]);
    return `        public static let ${name} = ThemedColor(\n            light: Color(red: ${light.r}, green: ${light.g}, blue: ${light.b}),\n            dark: Color(red: ${dark.r}, green: ${dark.g}, blue: ${dark.b})\n        )`;
  })
  .join('\n')}
    }

    /// Base sizes. \`relativeTo\` keeps every style scaling with the reader's
    /// text-size setting rather than freezing at a fixed size.
    public enum Typography {
${typographyNames
  .map((name) => {
    const t = tokens.typography[name];
    const relative =
      t.size >= 28 ? '.largeTitle' : t.size >= 20 ? '.title2' : t.size >= 16 ? '.body' : '.caption';
    return `        public static let ${name} = Font.system(size: ${t.size}, weight: ${swiftWeight[t.weight]}, design: .default)\n        public static let ${name}Relative = Font.custom("", size: ${t.size}, relativeTo: ${relative}).weight(${swiftWeight[t.weight]})`;
  })
  .join('\n')}
    }

    /// A clinical state is a colour *and* an icon: critical information is
    /// never carried by colour alone (spec section 7).
    public struct ClinicalState: Sendable, Equatable {
        public let color: ThemedColor
        public let iconName: String
    }

    public enum State {
${semanticNames
  .map(
    (name) =>
      `        public static let ${name} = ClinicalState(color: Palette.${tokens.semantic[name].color}, iconName: "${tokens.semantic[name].icon}")`,
  )
  .join('\n')}
    }
}

/// A colour with a variant for each scheme.
public struct ThemedColor: Sendable, Equatable {
    public let light: Color
    public let dark: Color

    public init(light: Color, dark: Color) {
        self.light = light
        self.dark = dark
    }

    public func resolve(for scheme: ColorScheme) -> Color {
        scheme == .dark ? dark : light
    }
}

public extension View {
    /// Applies a themed foreground colour without the caller branching on scheme.
    func foreground(_ color: ThemedColor, scheme: ColorScheme) -> some View {
        foregroundStyle(color.resolve(for: scheme))
    }
}
`;

// --- Kotlin ----------------------------------------------------------------

const kotlinWeight = {
  regular: 'FontWeight.Normal',
  semibold: 'FontWeight.SemiBold',
  bold: 'FontWeight.Bold',
};

const kotlin = `${BANNER}package xyz.klinik.design

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
    val minimumTouchTarget: Dp = ${tokens.meta.minimumTouchTargetPt}.dp

    object Spacing {
${Object.entries(tokens.spacing)
  .map(([name, value]) => `        val ${name}: Dp = ${value}.dp`)
  .join('\n')}
    }

    object Radius {
${Object.entries(tokens.radius)
  .map(([name, value]) => `        val ${name}: Dp = ${value}.dp`)
  .join('\n')}
    }

    object LightPalette {
${colorNames.map((name) => `        val ${name} = Color(0xFF${tokens.color.light[name].slice(1)})`).join('\n')}
    }

    object DarkPalette {
${colorNames.map((name) => `        val ${name} = Color(0xFF${tokens.color.dark[name].slice(1)})`).join('\n')}
    }

    data class TypeStyle(val size: TextUnit, val weight: FontWeight, val lineHeight: TextUnit)

    object Typography {
${typographyNames
  .map(
    (name) =>
      `        val ${name} = TypeStyle(${tokens.typography[name].size}.sp, ${kotlinWeight[tokens.typography[name].weight]}, ${tokens.typography[name].lineHeight}.sp)`,
  )
  .join('\n')}
    }

    /** A clinical state is a colour *and* an icon (spec section 7). */
    data class ClinicalState(val colorName: String, val iconName: String)

    object State {
${semanticNames
  .map(
    (name) =>
      `        val ${name} = ClinicalState("${tokens.semantic[name].color}", "${tokens.semantic[name].icon}")`,
  )
  .join('\n')}
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
${colorNames.map((name) => `    "${name}" to Tokens.LightPalette.${name},`).join('\n')}
)

private val darkColors: Map<String, Color> = mapOf(
${colorNames.map((name) => `    "${name}" to Tokens.DarkPalette.${name},`).join('\n')}
)
`;

const outputs = [
  ['ios/Sources/KlinikDesign/Tokens.generated.swift', swift],
  ['android/core/design/src/main/kotlin/xyz/klinik/design/Tokens.generated.kt', kotlin],
];

for (const [path, content] of outputs) {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`${path}: ${content.split('\n').length} lines`);
}
