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
 * Case folding that survives Turkish.
 *
 * `toLowerCase()` under a Turkish locale maps I to ı and İ to i, so "AYŞE" and
 * "Ayşe" fold to different strings and a name written in capitals slips past.
 * Folding the whole dotted/dotless family to `i` first, then lowercasing
 * invariantly, makes every spelling meet.
 */
function fold(value: string): string {
  return value.replace(/[İIıi]/g, 'i').toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Digits only, so +90 555 111 22 33 and 05551112233 compare equal. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Runs of digits as they appear in text, separators allowed inside them.
 *
 * Extracted as runs rather than by stripping every non-digit from the whole
 * text: flattening the document would let a lab value and a date sitting on
 * consecutive lines join into a number that matches a phone by accident.
 */
function digitRuns(text: string): string[] {
  return (text.match(/[0-9][0-9()\-.\s+]{5,}[0-9]|[0-9]{6,}/g) ?? []).map(digitsOf);
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

/**
 * Everything identifying found in a finished prompt.
 *
 * Returns all of them rather than the first: a caller fixing one leak should
 * see the others in the same refusal instead of discovering them one deploy at
 * a time.
 */
export function findLeaks(text: string, identifiers: Identifiers = {}): Leak[] {
  const leaks: Leak[] = [];
  const folded = fold(text);

  for (const name of identifiers.names ?? []) {
    const trimmed = (name ?? '').trim();
    if (trimmed.length < MIN_NAME_LENGTH) continue;

    const pattern = new RegExp(
      `(?<![${LETTER_CLASS}])${escapeRegExp(fold(trimmed))}(?![${LETTER_CLASS}])`,
      'u',
    );

    if (pattern.test(folded)) {
      leaks.push({ kind: 'name' });
      break;
    }
  }

  const mrn = identifiers.mrn?.trim();
  if (mrn && mrn.length >= 3 && folded.includes(fold(mrn))) {
    leaks.push({ kind: 'mrn' });
  }

  const email = identifiers.email?.trim();
  if (email && folded.includes(fold(email))) {
    leaks.push({ kind: 'email' });
  }

  const runs = digitRuns(text);

  const phone = digitsOf(identifiers.phone ?? '');
  if (phone.length >= 7) {
    // Compared on the last seven digits: the same line is written +90 532…,
    // 0532… and 532… by three different people, and all three are the leak.
    const tail = phone.slice(-7);
    if (runs.some((run) => run.includes(tail))) {
      leaks.push({ kind: 'phone' });
    }
  }

  if (runs.some((run) => containsNationalId(run))) {
    leaks.push({ kind: 'national-id' });
  }

  return leaks;
}

/** A national id can sit inside a longer run of digits. */
function containsNationalId(run: string): boolean {
  for (let start = 0; start + 11 <= run.length; start += 1) {
    if (looksLikeTurkishNationalId(run.slice(start, start + 11))) return true;
  }

  return false;
}
