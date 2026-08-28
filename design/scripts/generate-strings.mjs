#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Generates the Android string resources from the iOS catalogues.
 *
 * One catalogue, two platforms. Maintaining them separately means a string
 * added on one side and forgotten on the other — which shows up as English text
 * in a Turkish screen, or a raw key in front of a patient.
 *
 * The key shape differs because Android resource names cannot contain dots:
 * `auth.signIn` becomes `auth_sign_in`. The mapping is mechanical, so the two
 * key sets stay equivalent even though they are not identical.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const LANGUAGES = [
  { code: 'tr', androidDir: 'values' },
  { code: 'en', androidDir: 'values-en' },
];

export function parseStrings(text) {
  const entries = {};

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('"')) continue;

    const parts = line.split('" = "');
    if (parts.length !== 2) continue;

    entries[parts[0].slice(1)] = parts[1].slice(0, -2);
  }

  return entries;
}

/** `auth.signIn` -> `auth_sign_in` */
export function toAndroidName(key) {
  return key
    .replace(/\./g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/_+/g, '_');
}

const escapeXml = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');

/**
 * Guarded so importing this module for `parseStrings` and `toAndroidName` does
 * not rewrite the resource files as a side effect — which is exactly what the
 * checker doing so would hide.
 */
function generate() {
  for (const { code, androidDir } of LANGUAGES) {
    const source = resolve(root, `ios/Sources/KlinikCore/Resources/${code}.lproj/Localizable.strings`);
    const entries = parseStrings(readFileSync(source, 'utf8'));

    const lines = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<!-- Generated from ios/Sources/KlinikCore/Resources — do not edit.',
      '     Regenerate with: node design/scripts/generate-strings.mjs -->',
      '<resources>',
      // Sorted, so the file is deterministic and a diff shows only real changes.
      ...Object.keys(entries)
        .sort()
        .map((key) => `    <string name="${toAndroidName(key)}">${escapeXml(entries[key])}</string>`),
      '</resources>',
    ];

    const target = resolve(root, `android/core/design/src/main/res/${androidDir}/strings.xml`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${lines.join('\n')}\n`);

    console.log(`${androidDir}/strings.xml: ${Object.keys(entries).length} strings`);
  }
}

// argv[1] is absent when this module is imported through `node -e`, so it is
// checked before use rather than assumed.
const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  generate();
}
