#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Verifies the palette against WCAG 2.1 contrast ratios.
 *
 * Spec section 7 requires high contrast and a colour-blind-safe palette for an
 * app used by patients of every age. A palette that only looks accessible is
 * the usual failure, so the ratios are computed rather than asserted.
 */

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(resolve(here, '../tokens.json'), 'utf8'));

const channel = (value) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const ratio = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

/** Foreground/background pairs that carry meaning and must stay legible. */
const PAIRS = [
  ['textPrimary', 'background', 'normal'],
  ['textPrimary', 'surface', 'normal'],
  ['textPrimary', 'surfaceRaised', 'normal'],
  ['textSecondary', 'background', 'normal'],
  ['textSecondary', 'surface', 'normal'],
  ['accent', 'background', 'normal'],
  ['accent', 'surface', 'normal'],
  ['critical', 'background', 'normal'],
  ['critical', 'criticalSurface', 'normal'],
  ['warning', 'background', 'normal'],
  ['warning', 'warningSurface', 'normal'],
  ['success', 'background', 'normal'],
  ['success', 'successSurface', 'normal'],
  ['info', 'infoSurface', 'normal'],
  ['accentText', 'accent', 'normal'],
];

const targets = {
  normal: tokens.meta.contrastTargetNormalText,
  large: tokens.meta.contrastTargetLargeText,
};

let failures = 0;

for (const scheme of ['light', 'dark']) {
  const palette = tokens.color[scheme];
  console.log(`\n${scheme}:`);

  for (const [fg, bg, size] of PAIRS) {
    const value = ratio(palette[fg], palette[bg]);
    const target = targets[size];
    const ok = value >= target;

    if (!ok) {
      failures += 1;
    }

    console.log(
      `  ${ok ? 'OK  ' : 'FAIL'} ${fg} on ${bg}: ${value.toFixed(2)}:1 (target ${target}:1)`,
    );
  }
}

/**
 * Every clinical state pairs a colour with an icon. Colour alone cannot carry
 * a critical lab value to someone who cannot distinguish red from green.
 */
console.log('\nclinical states carry an icon as well as a colour:');
for (const [name, state] of Object.entries(tokens.semantic)) {
  if (name.startsWith('$')) continue;

  if (!state.icon) {
    console.log(`  FAIL ${name} has no icon`);
    failures += 1;
  } else {
    console.log(`  OK   ${name}: ${state.color} + ${state.icon}`);
  }
}

console.log(failures === 0 ? '\nAll contrast targets met.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
