#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrings, toAndroidName } from './generate-strings.mjs';

/**
 * Holds every string catalogue to the same key set.
 *
 * A key present in one language and missing in another is English appearing
 * mid-sentence in a Turkish screen, or a raw key shown to a patient. A key
 * present on one platform and missing on the other is a feature that silently
 * has no text on that device.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const read = (path) => parseStrings(readFileSync(resolve(root, path), 'utf8'));

const catalogues = {
  'iOS tr': read('ios/Sources/KlinikCore/Resources/tr.lproj/Localizable.strings'),
  'iOS en': read('ios/Sources/KlinikCore/Resources/en.lproj/Localizable.strings'),
};

const androidKeys = (path) => {
  const xml = readFileSync(resolve(root, path), 'utf8');
  return new Set([...xml.matchAll(/<string name="([^"]+)"/g)].map((match) => match[1]));
};

let failures = 0;
const report = (ok, message) => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${message}`);
  if (!ok) failures += 1;
};

console.log('string catalogues:');

const iosTurkish = new Set(Object.keys(catalogues['iOS tr']));
const iosEnglish = new Set(Object.keys(catalogues['iOS en']));

const missingInEnglish = [...iosTurkish].filter((key) => !iosEnglish.has(key));
const missingInTurkish = [...iosEnglish].filter((key) => !iosTurkish.has(key));

report(
  missingInEnglish.length === 0 && missingInTurkish.length === 0,
  `iOS tr and en define the same keys${
    missingInEnglish.length ? ` (missing in en: ${missingInEnglish.join(', ')})` : ''
  }${missingInTurkish.length ? ` (missing in tr: ${missingInTurkish.join(', ')})` : ''}`,
);

const expected = new Set([...iosTurkish].map(toAndroidName));

for (const [label, path] of [
  ['Android tr', 'android/core/design/src/main/res/values/strings.xml'],
  ['Android en', 'android/core/design/src/main/res/values-en/strings.xml'],
]) {
  const actual = androidKeys(path);
  const missing = [...expected].filter((key) => !actual.has(key));
  const extra = [...actual].filter((key) => !expected.has(key));

  report(
    missing.length === 0 && extra.length === 0,
    `${label} matches the iOS catalogue${missing.length ? ` (missing: ${missing.join(', ')})` : ''}${
      extra.length ? ` (unexpected: ${extra.join(', ')})` : ''
    }`,
  );
}

for (const [label, entries] of Object.entries(catalogues)) {
  const empty = Object.entries(entries).filter(([, value]) => value.trim().length === 0);
  const untranslated = Object.entries(entries).filter(([key, value]) => key === value);

  report(empty.length === 0, `${label} has no empty values`);
  report(untranslated.length === 0, `${label} has no key-as-value entries`);
}

/**
 * Android resource names are letters, digits and underscores.
 *
 * Checked here rather than left to the Android build, because the Android
 * modules only compile on a machine with the SDK — so a key with a hyphen in it
 * passes every local gate and fails in CI with a message that names the file and
 * not the key.
 */
for (const [name, path] of [
  ['values', 'android/core/design/src/main/res/values/strings.xml'],
  ['values-en', 'android/core/design/src/main/res/values-en/strings.xml'],
]) {
  const invalid = [...androidKeys(path)].filter((key) => !/^[a-z][a-z0-9_]*$/.test(key));

  report(invalid.length === 0, `${name} has only valid Android resource names`);

  for (const key of invalid) {
    console.log(`       invalid: ${key}`);
  }
}

console.log(failures === 0 ? '\nAll catalogues agree.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
