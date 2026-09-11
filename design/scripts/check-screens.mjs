#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Two rules the iOS review found the hard way, both invisible to the compiler
 * and both invisible to the tests that were supposed to cover them.
 *
 * 1. A date symbol read from a locale-less calendar.
 *
 *    `Calendar(identifier: .gregorian)` carries no locale and answers with
 *    fixed English abbreviations — "Mon", "Tue". That is what a Turkish
 *    clinician was reading above their own working hours, and the test that
 *    should have caught it compared the screen against the same wrong object.
 *
 * 2. A screen that can be navigated to with no title.
 *
 *    A pushed screen with no `navigationTitle` shows a bare back chevron and
 *    nothing saying where the reader is. Ten screens were like this.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const sourceRoot = join(root, 'ios/Sources');

const sources = (directory) => {
  const found = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sources(path));
    } else if (entry.endsWith('.swift')) {
      found.push(path);
    }
  }

  return found;
};

/**
 * Screens that carry no title on purpose.
 *
 * Each one is either a navigation root (the bar belongs to the stack or the
 * tab), or a sheet that brings its own, or a screen whose title is set where
 * it is pushed because only the caller knows it — a patient's name.
 */
const TITLE_EXEMPT = new Set([
  'HomeScreen', // The patient's root. Greets by name in the body instead.
  'StaffHomeScreen', // The agenda tab's own title.
  'AuthFlowView', // Reached before there is a navigation stack.
  'PatientFileScreen', // Titled with the patient's name where it is pushed.
  'PatientListView', // The patients tab's own title.
  'EmergencyQueueScreen', // The emergency tab's own title.
  'RootView', // The shell above every stack. It has no bar of its own.
]);

/**
 * The file with its comments removed.
 *
 * The note explaining *why* a rule exists usually quotes the thing the rule
 * forbids, and a checker that reads its own documentation as a violation is a
 * checker nobody leaves switched on.
 */
const withoutComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const symbolAccess = /\b(?:weekday|month|quarter|era|amPm)\w*Symbols\b/;

function fixedLocaleFindings(paths) {
  const findings = [];

  for (const path of paths) {
    const text = withoutComments(readFileSync(path, 'utf8'));

    if (!symbolAccess.test(text) || !/Calendar\(identifier:/.test(text)) continue;
    // An explicit locale is the author saying which language they meant.
    if (/\.locale\s*=/.test(text)) continue;

    const line = text.split('\n').findIndex((l) => symbolAccess.test(l)) + 1;

    findings.push(
      `  FAIL ${relative(root, path)}:${line}  date symbols read from a ` +
        'Calendar(identifier:) with no locale — use Calendar.current',
    );
  }

  return findings;
}

/**
 * Public `View` types that load something and have no title.
 *
 * Loading is the signal that it is a screen rather than a row or a control:
 * a thing with a `task` or a `refreshable` is a thing somebody navigated to.
 */
function untitledScreens(paths) {
  const findings = [];

  for (const path of paths) {
    const lines = withoutComments(readFileSync(path, 'utf8')).split('\n');
    const declarations = [];

    lines.forEach((line, index) => {
      const found = /^public struct (\w+)\s*:\s*[^{]*\bView\b/.exec(line);
      if (found) declarations.push({ name: found[1], line: index });
    });

    declarations.forEach((declaration, position) => {
      const end = declarations[position + 1]?.line ?? lines.length;
      const body = lines.slice(declaration.line, end).join('\n');

      const isScreen = /\.task\s*[({]|\.refreshable\s*\{/.test(body);
      if (!isScreen || TITLE_EXEMPT.has(declaration.name)) return;
      if (/\.navigationTitle\(/.test(body)) return;

      findings.push(
        `  FAIL ${relative(root, path)}:${declaration.line + 1}  ` +
          `${declaration.name} loads but sets no navigationTitle`,
      );
    });
  }

  return findings;
}

const paths = sources(sourceRoot);
const findings = [...fixedLocaleFindings(paths), ...untitledScreens(paths)];

console.log('screens:');

if (findings.length === 0) {
  console.log('  OK   no date symbols read from a locale-less calendar');
  console.log('  OK   every screen that loads has a navigation title');
  process.exit(0);
}

console.log(findings.join('\n'));
console.log(`\n${findings.length} finding(s).`);
console.log(
  '\nA locale-less calendar answers in English; a pushed screen with no title\n' +
    'shows a bare back chevron. Both were found by reading, not by the tests.',
);
process.exit(1);
