import { TriageLevel } from '@prisma/client';

/**
 * The rule that makes AI triage safe to ship (spec section 14.3).
 *
 * "Nothing classified critical is left to the AI alone" is usually read as a
 * rule about what happens *after* a critical classification. The dangerous half
 * is the other one: the model reading "göğsüm ağrıyor" and answering INFO, the
 * message dropping into a low-priority pile, and nobody ever knowing it was
 * misread.
 *
 * So a classification is applied as a **floor, never an assignment**. The AI
 * can raise a message's urgency and can never lower it. A model that is off,
 * unpaid for, rate-limited, timed out, jailbroken by the message it is reading,
 * or simply wrong leaves the clinic exactly where it would have been without
 * it — which is the only property that makes it safe to put an AI in this path
 * at all.
 */
const ORDER: Record<TriageLevel, number> = {
  [TriageLevel.INFO]: 0,
  [TriageLevel.ROUTINE]: 1,
  [TriageLevel.URGENT]: 2,
  [TriageLevel.EMERGENCY]: 3,
};

export function raiseTo(current: TriageLevel, candidate: TriageLevel | null): TriageLevel {
  if (candidate === null) return current;

  return ORDER[candidate] > ORDER[current] ? candidate : current;
}

/** Whether this level should put a notification on somebody's phone now. */
export function needsImmediateAttention(level: TriageLevel): boolean {
  return ORDER[level] >= ORDER[TriageLevel.URGENT];
}

export interface TriageSummary {
  /** M5's three lines, for the doctor. */
  complaint: string;
  measurements: string;
  duration: string;
}

export interface TriageVerdict {
  level: TriageLevel;
  summary: TriageSummary;
}

const LEVELS = new Set<string>(Object.values(TriageLevel));

/**
 * Reads the model's answer, and returns nothing rather than a guess.
 *
 * Every failure here — prose around the JSON, a level the model invented, a
 * truncated object, an empty string — returns null, which `raiseTo` treats as
 * "no contribution" and leaves the floor standing. The one thing this must
 * never do is fall back to a default level: a parser that answers INFO when it
 * cannot understand the model has quietly become the thing that decides nobody
 * needs to read the message.
 */
export function parseVerdict(raw: string): TriageVerdict | null {
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
  const level = typeof record.triage === 'string' ? record.triage.trim().toUpperCase() : '';

  if (!LEVELS.has(level)) return null;

  return {
    level: level as TriageLevel,
    summary: {
      complaint: text(record.complaint),
      measurements: text(record.measurements),
      duration: text(record.duration),
    },
  };
}

/**
 * The first balanced JSON object in the response.
 *
 * Models wrap JSON in code fences and introduce it with a sentence however
 * firmly the prompt says not to, and a brace-counting scan costs less than a
 * retry.
 */
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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 500) : '';
}

/** Whether a summary says anything worth showing a clinician. */
export function hasContent(summary: TriageSummary): boolean {
  return [summary.complaint, summary.measurements, summary.duration].some(
    (line) => line.length > 0,
  );
}

/** The three lines M5 asks for, as one block stored on the message. */
export function renderSummary(summary: TriageSummary): string {
  return [
    `Şikayet: ${summary.complaint || '—'}`,
    `Ölçülen değerler: ${summary.measurements || '—'}`,
    `Süre: ${summary.duration || '—'}`,
  ].join('\n');
}
