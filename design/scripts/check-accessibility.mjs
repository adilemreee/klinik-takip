#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The accessibility failures a script can actually see (T7.4).
 *
 * Deliberately narrow. Whether a label reads well to somebody using VoiceOver
 * is a judgement no checker makes, and pretending otherwise would turn an audit
 * into a green tick nobody trusts. What a script *can* do is catch the four
 * mechanical failures that recur, each of which makes a screen unusable rather
 * than merely awkward:
 *
 *   1. A decorative icon left in the accessibility tree, so a screen reader
 *      announces "image" between every two useful words.
 *   2. A tappable thing smaller than the minimum target, which a person with a
 *      tremor cannot hit.
 *   3. State conveyed by colour alone — the failure that is invisible to the
 *      person who wrote it and total for the person who cannot distinguish the
 *      colours (spec section 7).
 *   4. A progress spinner with nothing to announce, so the screen reader says
 *      nothing at all while the app is working.
 *
 * Everything else — reading order, label wording, focus behaviour — needs a
 * person with VoiceOver and TalkBack, and docs/ERISILEBILIRLIK.md says so.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const findings = [];

const report = (file, line, rule, detail) => {
  findings.push({ file, line, rule, detail });
};

function* sources(directory, extensions) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      if (entry === 'build' || entry === '.build' || entry === 'node_modules') continue;
      yield* sources(path, extensions);
    } else if (extensions.includes(extname(entry))) {
      yield path;
    }
  }
}

/**
 * An icon with no label and nothing hiding it.
 *
 * Allowed inside a `Label(...)`, which pairs it with text, and when the file
 * marks it decorative on the same or an adjacent line.
 */
function checkIcons(path, lines) {
  lines.forEach((text, index) => {
    const isSwiftIcon = /Image\(systemName:/.test(text);
    if (!isSwiftIcon) return;

    // Wide enough to reach past a comment explaining why it is decorative.
    const window = lines.slice(Math.max(0, index - 2), index + 8).join('\n');

    const labelled =
      /accessibilityLabel|accessibilityHidden|Label\(/.test(window) ||
      // Inside a container the file has already collapsed for VoiceOver.
      /accessibilityElement\(children: \.combine\)|clearAndSetSemantics/.test(window);

    if (!labelled) {
      report(path, index + 1, 'icon-without-label', text.trim());
    }
  });
}

/** A tappable thing with no minimum height near it. */
function checkTouchTargets(path, lines) {
  const source = lines.join('\n');

  lines.forEach((text, index) => {
    if (!/^\s*(Button|TextButton)\(/.test(text)) return;

    // Inside a Menu, the system sizes the rows and a minimum height on the
    // label does nothing. Flagging them trains people to ignore the checker.
    const enclosing = lines.slice(Math.max(0, index - 20), index).join('\n');
    if (/\bMenu\s*\{/.test(enclosing) || /DropdownMenu\(/.test(enclosing)) return;

    const window = lines.slice(index, index + 8).join('\n');

    // Either the file sets a minimum, or the whole file does it once in a
    // helper — both are fine, and a checker that could not tell would be noise.
    const sized =
      /minimumTouchTarget/.test(window) ||
      /minimumTouchTarget/.test(source) ||
      // Material and SwiftUI's own bordered styles already meet the minimum.
      /buttonStyle\(\.borderedProminent\)|buttonStyle\(\.bordered\)/.test(window);

    if (!sized) {
      report(path, index + 1, 'touch-target-unchecked', text.trim());
    }
  });
}

/**
 * A colour with no word beside it.
 *
 * Looks for a tint chosen from state and checks that the same block also
 * renders a localised name. This is the rule the codebase states repeatedly;
 * the checker is what keeps it true.
 */
function checkColourOnly(path, lines) {
  lines.forEach((text, index) => {
    const tints = /(foregroundStyle|color =)\s*.*\b(tint|tintFor)\b/.test(text);
    if (!tints) return;

    const window = lines.slice(Math.max(0, index - 6), index + 3).join('\n');

    if (!/localizedName|statusName|flagName|\.status\b/.test(window)) {
      report(path, index + 1, 'colour-without-words', text.trim());
    }
  });
}

/** A spinner that announces nothing. */
function checkSpinners(path, lines) {
  lines.forEach((text, index) => {
    if (!/ProgressView\(\)/.test(text)) return;

    const window = lines.slice(index, index + 3).join('\n');

    // A label, or an explicit decision that it is decorative. Both are answers;
    // silence is not.
    if (!/accessibilityLabel|accessibilityHidden/.test(window)) {
      report(path, index + 1, 'spinner-without-label', text.trim());
    }
  });
}

const swiftRoots = [join(root, 'ios/Sources')];
const kotlinRoots = [join(root, 'android/feature'), join(root, 'android/core/design')];

for (const directory of swiftRoots) {
  for (const path of sources(directory, ['.swift'])) {
    const lines = readFileSync(path, 'utf8').split('\n');
    const shown = relative(root, path);

    checkIcons(shown, lines);
    checkTouchTargets(shown, lines);
    checkColourOnly(shown, lines);
    checkSpinners(shown, lines);
  }
}

for (const directory of kotlinRoots) {
  for (const path of sources(directory, ['.kt'])) {
    const lines = readFileSync(path, 'utf8').split('\n');
    const shown = relative(root, path);

    checkTouchTargets(shown, lines);
    checkColourOnly(shown, lines);
  }
}

console.log('accessibility:');

if (findings.length === 0) {
  console.log('  OK   no mechanical failures found');
  console.log('\nThis checks four things a script can see. Reading order, label');
  console.log('wording and focus behaviour need VoiceOver and TalkBack — see');
  console.log('docs/ERISILEBILIRLIK.md.');
  process.exit(0);
}

for (const { file, line, rule, detail } of findings) {
  console.log(`  FAIL ${file}:${line}  ${rule}`);
  console.log(`       ${detail}`);
}

console.log(`\n${findings.length} finding(s).`);
process.exit(1);
