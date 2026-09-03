/**
 * What leaves this system, and what must never (spec section 14.4).
 *
 * The rule in the specification is "minimise the patient data sent to the AI;
 * pseudonymise unless identity is genuinely needed". Two mechanisms, because
 * one of them is not enough:
 *
 *   - `pseudonymise` builds the only patient shape a prompt is allowed to
 *     carry. It has no name, no file number, no contact details and no birth
 *     date — an age instead, because the clinical question is almost always
 *     "how old" and never "born when".
 *   - `findLeaks` reads the finished prompt and looks for the identifiers
 *     anyway. That is not redundancy: prompts are built from free text — a
 *     patient's own message, a clinician's note, an OCR'd report — and the
 *     patient's name is very often written inside it. The structured shape
 *     cannot see that, and the outgoing request is the last place anyone can.
 */

export interface Identifiers {
  /** Given and family names, in any order. */
  names?: (string | null | undefined)[];
  mrn?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface PatientLike {
  birthDate?: Date | null;
  sex?: string | null;
  country?: string | null;
  preferredLanguage?: string | null;
}

/** The only patient shape a prompt may carry. */
export interface SafePatient {
  /**
   * An opaque label for this request, so a prompt can refer to the patient
   * without naming them. Not stable across requests: a token that persisted
   * would become an identifier of its own.
   */
  ref: string;
  age: number | null;
  sex: string | null;
  /**
   * Country, not city. Country drives language and discharge advice; a city
   * plus a procedure plus a date narrows a small clinic to one person.
   */
  country: string | null;
  preferredLanguage: string;
}

export type LeakKind = 'name' | 'mrn' | 'phone' | 'email' | 'national-id';

/**
 * What a redacted identifier is replaced with.
 *
 * Kept as words rather than blanked out: a model reading "[ad] dün akşam
 * ateşlendi" understands a person was named there, where "*** dün akşam" reads
 * as corruption. Explained in the system prompt so the token is never mistaken
 * for something the patient wrote.
 */
const PLACEHOLDERS: Record<LeakKind, string> = {
  name: '[ad]',
  mrn: '[dosya-no]',
  phone: '[telefon]',
  email: '[e-posta]',
  'national-id': '[kimlik-no]',
};

/**
 * Deliberately carries the *kind* and never the value.
 *
 * A refusal gets logged, and a log line naming the identifier it refused to
 * send would be the leak it just prevented, written somewhere it is kept for
 * weeks.
 */
export interface Leak {
  kind: LeakKind;
}

/**
 * Names shorter than this are not searched for.
 *
 * "Su" and "Ali" appear inside ordinary Turkish words; matching them would
 * refuse almost every prompt, and a check that refuses everything gets turned
 * off. Three characters with letter boundaries is the point where the check
 * stays useful — and it is stated here rather than left as a magic number,
 * because it is a real hole: a two-letter name is not caught by this pass and
 * relies on `pseudonymise` having kept it out in the first place.
 */
const MIN_NAME_LENGTH = 3;

/** Letters that may sit next to a name without it being a separate word. */
const LETTER_CLASS = 'a-zçğöşü0-9';

export function ageFrom(birthDate: Date | null | undefined, now = new Date()): number | null {
  if (!birthDate) return null;

  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - birthDate.getUTCMonth();

  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < birthDate.getUTCDate())) {
    age -= 1;
  }

  return age >= 0 && age < 150 ? age : null;
}

export function pseudonymise(patient: PatientLike, ref: string, now = new Date()): SafePatient {
  return {
    ref,
    age: ageFrom(patient.birthDate, now),
    sex: patient.sex ?? null,
    country: patient.country ?? null,
    preferredLanguage: patient.preferredLanguage ?? 'tr',
  };
}

/**
 * Case folding that survives Turkish, one code unit at a time.
 *
 * `toLowerCase()` under a Turkish locale maps I to ı and İ to i, so "AYŞE" and
 * "Ayşe" fold to different strings and a name written in capitals slips past.
 * Folding the whole dotted/dotless family to `i` first, then lowercasing,
 * makes every spelling meet.
 *
 * Done per code unit, and any character whose lowercase is not a single unit
 * left alone, because the folded string's indices are used to cut the original
 * apart for redaction. A fold that changed the length by one would move every
 * cut after it.
 */
function fold(value: string): string {
  let folded = '';

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;

    if ('İIıi'.includes(character)) {
      folded += 'i';
      continue;
    }

    const lower = character.toLowerCase();
    folded += lower.length === 1 ? lower : character;
  }

  return folded;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Digits only, so +90 555 111 22 33 and 05551112233 compare equal. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * A Turkish national identity number, by its own checksum.
 *
 * Worth a rule of its own because it is the identifier most likely to be typed
 * into a free-text note, it never has a legitimate reason to reach a model, and
 * unlike a name it can be recognised without knowing whose it is. The checksum
 * is what keeps this from firing on any eleven-digit number.
 */
export function looksLikeTurkishNationalId(digits: string): boolean {
  if (!/^[1-9][0-9]{10}$/.test(digits)) return false;

  const d = [...digits].map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;

  if ((odd * 7 - even) % 10 !== d[9]) return false;

  const firstTen = d.slice(0, 10).reduce((sum, digit) => sum + digit, 0);

  return firstTen % 10 === d[10];
}

interface Span {
  kind: LeakKind;
  start: number;
  end: number;
}

/**
 * Where every identifier sits in the text.
 *
 * One implementation behind both `findLeaks` and `redact`, so what the check
 * refuses is exactly what the scrubber removes. Two matchers would drift, and
 * the direction they drift in is a prompt that passes the check with something
 * the scrubber missed.
 */
function spansOf(text: string, identifiers: Identifiers): Span[] {
  const folded = fold(text);
  const spans: Span[] = [];

  for (const name of identifiers.names ?? []) {
    const trimmed = (name ?? '').trim();
    if (trimmed.length < MIN_NAME_LENGTH) continue;

    const pattern = new RegExp(
      `(?<![${LETTER_CLASS}])${escapeRegExp(fold(trimmed))}(?![${LETTER_CLASS}])`,
      'gu',
    );

    for (const match of folded.matchAll(pattern)) {
      spans.push({ kind: 'name', start: match.index, end: match.index + match[0].length });
    }
  }

  for (const [kind, value] of [
    ['mrn', identifiers.mrn],
    ['email', identifiers.email],
  ] as [LeakKind, string | null | undefined][]) {
    const needle = fold((value ?? '').trim());
    if (needle.length < 3) continue;

    let at = folded.indexOf(needle);
    while (at !== -1) {
      spans.push({ kind, start: at, end: at + needle.length });
      at = folded.indexOf(needle, at + needle.length);
    }
  }

  const phone = digitsOf(identifiers.phone ?? '');
  // Matched on the last seven digits: the same line is written +90 532…, 0532…
  // and 532… by three different people, and all three are the leak.
  const tail = phone.length >= 7 ? phone.slice(-7) : null;

  for (const run of digitRuns(text)) {
    if (tail !== null && run.digits.includes(tail)) {
      spans.push({ kind: 'phone', start: run.start, end: run.end });
      continue;
    }

    if (containsNationalId(run.digits)) {
      spans.push({ kind: 'national-id', start: run.start, end: run.end });
    }
  }

  return spans;
}

/**
 * Everything identifying found in a finished prompt.
 *
 * Every kind at once rather than the first: a caller fixing one leak should see
 * the others in the same refusal instead of discovering them one deploy at a
 * time.
 */
export function findLeaks(text: string, identifiers: Identifiers = {}): Leak[] {
  const kinds = new Set(spansOf(text, identifiers).map((span) => span.kind));

  return [...kinds].map((kind) => ({ kind }));
}

export interface Redaction {
  text: string;
  /** Which kinds were removed. Kinds, never values — see `Leak`. */
  redacted: LeakKind[];
}

/**
 * Takes the identifiers out instead of refusing the prompt.
 *
 * The gate in `AIService` refuses a prompt that carries identifiers, which is
 * right when the prompt was supposed to be built clean. It is wrong for a
 * patient's own message: people sign their messages, and refusing every one
 * that says "Ben Ayşe" would leave exactly those messages untriaged. So the
 * text is scrubbed first and the gate then finds nothing — the check still
 * runs, and it is now checking the scrubber.
 */
export function redact(text: string, identifiers: Identifiers = {}): Redaction {
  const spans = spansOf(text, identifiers).sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );

  // An e-mail address contains the name it was made from, so the spans overlap.
  // Replacing both would cut the placeholder in half; the outermost match wins.
  const kept: Span[] = [];
  let consumedTo = -1;

  for (const span of spans) {
    if (span.start < consumedTo) continue;
    kept.push(span);
    consumedTo = span.end;
  }

  let result = text;

  // Back to front, so an earlier replacement cannot move a later index.
  for (const span of [...kept].reverse()) {
    result = result.slice(0, span.start) + PLACEHOLDERS[span.kind] + result.slice(span.end);
  }

  return { text: result, redacted: [...new Set(kept.map((span) => span.kind))] };
}

interface DigitRun {
  digits: string;
  start: number;
  end: number;
}

/**
 * Runs of digits as they appear in text, separators allowed inside them.
 *
 * Extracted as runs rather than by stripping every non-digit from the whole
 * text: flattening the document would let a lab value and a date sitting on
 * consecutive lines join into a number that matches a phone by accident.
 */
function digitRuns(text: string): DigitRun[] {
  const runs: DigitRun[] = [];

  for (const match of text.matchAll(/[0-9][0-9()\-.\s+]{5,}[0-9]|[0-9]{6,}/g)) {
    runs.push({
      digits: digitsOf(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return runs;
}

/** A national id can sit inside a longer run of digits. */
function containsNationalId(run: string): boolean {
  for (let start = 0; start + 11 <= run.length; start += 1) {
    if (looksLikeTurkishNationalId(run.slice(start, start + 11))) return true;
  }

  return false;
}
