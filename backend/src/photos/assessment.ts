/**
 * The photo pre-assessment (spec M5).
 *
 * The specification is unusually precise about what this is, and the precision
 * is the whole design: redness, discharge or swelling in a wound photograph
 * produce a **flag** — "a clinician should look" — and never a diagnosis.
 *
 * So the model is not asked what is wrong. It is asked which of four things it
 * can see, from a closed list, and the flag is computed from the answer rather
 * than taken from it. A model that writes "selülit şüphesi" gets its answer
 * thrown away, because "selülit" is not in the vocabulary and there is nowhere
 * for it to go.
 */

/**
 * Everything the assessment is allowed to say it saw.
 *
 * A closed list rather than free text, because free text is where a diagnosis
 * gets in. Each id is what the clinic's screen renders; the model never writes
 * the words a clinician reads.
 */
export const FINDINGS = ['redness', 'discharge', 'swelling', 'wound-open'] as const;

export type Finding = (typeof FINDINGS)[number];

const KNOWN = new Set<string>(FINDINGS);

export interface Assessment {
  /** What the model reported seeing, filtered to the vocabulary. */
  findings: Finding[];
  /**
   * Whether a clinician should look at this photo sooner.
   *
   * Computed here rather than taken from the model: a model that reports
   * discharge and then says no review is needed has contradicted itself, and
   * the half of that answer worth acting on is the observation.
   */
  reviewSuggested: boolean;
}

/**
 * Any finding at all means a clinician looks.
 *
 * There is no threshold and no confidence score. A threshold on a
 * pre-assessment is a machine deciding a wound is not worth a human's time,
 * which is exactly the decision this feature must not make.
 */
export function flagFrom(findings: Finding[]): boolean {
  return findings.length > 0;
}

/**
 * Reads the model's answer, and returns nothing rather than a guess.
 *
 * Same rule as everywhere else in this layer: an unreadable answer is not an
 * assessment. A photo that was not assessed stays unassessed, which is exactly
 * how every photo in the system started out and is a state the queue already
 * knows how to show.
 */
export function parseAssessment(raw: string): Assessment | null {
  const json = extractObject(raw);
  if (json === null) return null;

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;

  const record = parsed as Record<string, unknown>;

  if (!Array.isArray(record.findings)) return null;

  // Anything outside the vocabulary is dropped rather than passed through. This
  // is where a condition name would have entered.
  const findings = [
    ...new Set(
      record.findings
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().toLowerCase())
        .filter((value): value is Finding => KNOWN.has(value)),
    ),
  ];

  return { findings, reviewSuggested: flagFrom(findings) };
}

function extractObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, index + 1);
    }
  }

  return null;
}

/** Images the providers accept, and that this system stores. */
const SUPPORTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function isAssessable(mime: string): boolean {
  return SUPPORTED_MIME.has(mime.toLowerCase());
}
