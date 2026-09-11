#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every path the iOS app asks for, against the paths the server answers.
 *
 * A client that calls a route nobody serves compiles, passes every unit test,
 * and fails only in somebody's hands. That is how `approve` and `stop` shipped
 * addressed to `patients/:id/medications/:id/approve` — a route the server has
 * never had — leaving a doctor pressing "Onayla" on a prescription and getting
 * a 404 with nothing to explain it.
 *
 * The contract is `docs/openapi.json`, which CI already checks is current, so
 * this compares the two things that are supposed to agree.
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

/** `patients/\(id)/documents` -> `patients/{}/documents`. Parens balanced. */
const withoutInterpolation = (text) => {
  let out = '';

  for (let i = 0; i < text.length; ) {
    if (text.startsWith('\\(', i)) {
      let depth = 1;
      let j = i + 2;

      while (j < text.length && depth > 0) {
        if (text[j] === '(') depth += 1;
        else if (text[j] === ')') depth -= 1;
        j += 1;
      }

      out += '{}';
      i = j;
    } else {
      out += text[i];
      i += 1;
    }
  }

  return out;
};

const normalise = (path) => path.replace(/\{[^}]*\}/g, '{}').replace(/^\/+/, '');

/**
 * A request the app makes, as one or more concrete paths.
 *
 * `subject.base("photos")` is written once and means two routes — the
 * patient's own and a named patient's — so it is checked as both. Anything
 * that cannot be read statically is reported rather than skipped quietly: a
 * path this script cannot see is a path it cannot protect.
 */
function requestedPaths(files) {
  const found = [];
  const literal = /path:\s*"((?:[^"\\]|\\.)*)"/g;
  const subject = /path:\s*(?:subject|self\.subject)\.base\(\s*"([^"]*)"\s*\)/g;

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const line = (index) => text.slice(0, index).split('\n').length;

    for (const match of text.matchAll(literal)) {
      found.push({
        file,
        line: line(match.index),
        paths: [normalise(withoutInterpolation(match[1]))],
      });
    }

    for (const match of text.matchAll(subject)) {
      const suffix = match[1];
      found.push({
        file,
        line: line(match.index),
        paths: [`me/${suffix}`, `patients/{}/${suffix}`].map(normalise),
      });
    }
  }

  return found;
}

const spec = JSON.parse(readFileSync(join(root, 'docs/openapi.json'), 'utf8'));
const served = new Set(Object.keys(spec.paths).map(normalise));

/**
 * Paths the app builds somewhere this script cannot follow.
 *
 * Each one is named, so a new unreadable path shows up as a failure rather
 * than as silence. `basePath` is `MeasurementSubject`'s own `me/measurements`
 * or `patients/{}/measurements`; the rest are composed from a base above.
 */
const UNREADABLE = new Set(['{}/chart', '{}/latest', '{}/{}', '{}']);

const findings = [];

for (const request of requestedPaths(sources(join(root, 'ios/Sources')))) {
  for (const path of request.paths) {
    if (served.has(path) || UNREADABLE.has(path)) continue;

    findings.push(
      `  FAIL ${relative(root, request.file)}:${request.line}  ` +
        `/${path} is not a route the server answers`,
    );
  }
}

console.log('api paths:');

if (findings.length === 0) {
  console.log('  OK   every path the app asks for is one the server serves');
  process.exit(0);
}

console.log([...new Set(findings)].join('\n'));
console.log(`\n${findings.length} finding(s).`);
console.log(
  '\nThe contract is docs/openapi.json. If the route is new, run\n' +
    '`npm run api:export` in backend/ and commit it; if the path is wrong, fix the caller.',
);
process.exit(1);
