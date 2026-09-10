#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Finds View statics that a test calls without `nonisolated`.
 *
 * A `View` is implicitly main-actor isolated, and the compiler in CI carries
 * that isolation to the type's `static` members while the newer one here does
 * not. So a pure helper hanging off a screen compiles locally and fails in CI
 * with "call to main actor-isolated static method ... in a synchronous
 * nonisolated context" — three times now, each costing a round trip.
 *
 * The rule is not "every View static must be nonisolated": most are only ever
 * read from the view's own body, where the isolation is correct and saying
 * `nonisolated` would be noise. It is *called from a test* that makes it a
 * problem, because a test method is nonisolated. So that is what this checks.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

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

/** Static members of every `View` type, with whether they say `nonisolated`. */
function viewStatics(paths) {
  const members = new Map();

  for (const path of paths) {
    const lines = readFileSync(path, 'utf8').split('\n');
    let type = null;

    lines.forEach((line, index) => {
      // Column zero only. A nested type is indented, and treating one as a new
      // top-level declaration loses everything declared after it — which is how
      // this check first shipped reporting a clean sweep over a member that was
      // about to fail in CI.
      const declaration = /^(?:public |internal |private |fileprivate )?(?:struct|class|enum|actor|extension)\s+(\w+)/.exec(line);

      if (declaration) {
        // Only View types carry the isolation this checks for.
        type = /:\s*[^{]*\bView\b/.test(line) ? declaration[1] : null;
        return;
      }

      if (!type) return;

      const member = /^\s*(nonisolated\s+)?(?:public |internal |private |fileprivate )?(?:nonisolated\s+)?static\s+(?:func|var|let)\s+(\w+)/.exec(line);

      if (!member) return;

      const previous = lines[index - 1] ?? '';
      const isolated = !(member[1] || /nonisolated/.test(previous) || /nonisolated/.test(line));

      members.set(`${type}.${member[2]}`, {
        isolated,
        where: `${relative(root, path)}:${index + 1}`,
      });
    });
  }

  return members;
}

/**
 * Whether the code at this line is already on the main actor.
 *
 * A test that says `@MainActor` — on the method or on the whole class — is in
 * the same isolation as the view, so the call is legal and the member needs no
 * annotation. Flagging those would be noise, and a check that cries wolf gets
 * turned off.
 */
function isMainActor(lines, index) {
  let sawEnclosingFunction = false;

  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const line = lines[cursor];

    // The *enclosing* method only — the first one found walking up. Anything
    // above that is a sibling, and a sibling's annotation says nothing about
    // this call. Getting that wrong made the check pass over the very error it
    // was written for.
    if (
      !sawEnclosingFunction &&
      /^\s*(?:@MainActor\s+)?(?:public |internal |private |)?func\s/.test(line)
    ) {
      sawEnclosingFunction = true;

      if (/@MainActor/.test(line) || /@MainActor/.test(lines[cursor - 1] ?? '')) {
        return true;
      }
    }

    if (/^(?:@MainActor\s+)?(?:public |internal |private |final |)*class\s/.test(line)) {
      return /@MainActor/.test(line) || /@MainActor/.test(lines[cursor - 1] ?? '');
    }
  }

  return false;
}

/** Every `Type.member` a test names from a nonisolated, synchronous context. */
function referencedByTests(paths) {
  const referenced = new Map();

  for (const path of paths) {
    const lines = readFileSync(path, 'utf8').split('\n');

    lines.forEach((line, index) => {
      // A call already awaited is fine: the isolation hop is explicit.
      if (/\bawait\b/.test(line)) return;
      if (isMainActor(lines, index)) return;

      for (const match of line.matchAll(/\b([A-Z]\w+)\.(\w+)\b/g)) {
        referenced.set(`${match[1]}.${match[2]}`, `${relative(root, path)}:${index + 1}`);
      }
    });
  }

  return referenced;
}

const statics = viewStatics(sources(join(root, 'ios/Sources')));
const tests = referencedByTests(sources(join(root, 'ios/Tests')));

const findings = [];

for (const [name, reference] of tests) {
  const member = statics.get(name);

  if (member?.isolated) {
    findings.push(
      `  FAIL ${member.where}  ${name} is called from ${reference} and is not nonisolated`,
    );
  }
}

console.log('isolation:');

if (findings.length === 0) {
  console.log('  OK   every View static a test calls is nonisolated');
  process.exit(0);
}

console.log(findings.join('\n'));
console.log(`\n${findings.length} finding(s).`);
console.log(
  '\nA View is main-actor isolated and the compiler in CI carries that to its\n' +
    'statics. A test method is nonisolated, so the call will not compile there.\n' +
    'Mark the member `nonisolated` — see docs/KATKI-KURALLARI.md.',
);
process.exit(1);
