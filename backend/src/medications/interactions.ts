import {
  INGREDIENTS,
  INTERACTIONS,
  type Severity,
} from './interaction-reference';

/**
 * Checking a patient's medication against the reference (spec M5, M9).
 *
 * Two things decide whether this is useful, and only one of them is the table.
 *
 * The first is **name normalisation**. A prescription says "Amoklavin", a
 * patient types "augmentin", a discharge letter says "amoksisilin klavulanat",
 * and a checker that matches on strings recognises none of them as the same
 * drug — so it finds no interactions and looks like it is working.
 *
 * The second is **what silence means**. This table is small. A clinician who
 * reads "no interactions" as "safe" has been misled by software, so every
 * answer carries the drugs it could not recognise, and a check that recognised
 * nothing says so rather than returning an empty list of warnings.
 */

export interface Prescribed {
  /** Whatever it was written as. */
  id: string;
  drugName: string;
}

export interface InteractionWarning {
  severity: Severity;
  note: string;
  /** Ingredient codes, for the client's own rendering. */
  ingredients: [string, string];
  /** The medications as they were written, so a clinician sees their own words. */
  between: [Prescribed, Prescribed];
}

export interface InteractionCheck {
  warnings: InteractionWarning[];
  /**
   * Drugs whose name matched nothing in the reference.
   *
   * The most important field here. A clinician reading "no interactions" while
   * three of four drugs were unrecognised has been told nothing, and this is
   * what stops the answer being mistaken for reassurance.
   */
  unrecognised: Prescribed[];
  /** How many pairs were actually compared. Zero means nothing was checked. */
  comparedPairs: number;
}

/**
 * Folding for drug names.
 *
 * Turkish casing first — "İBUPROFEN" and "ibuprofen" have to meet — then
 * diacritics, then everything that is not a letter or a digit. Dose strengths
 * and forms are stripped with it, so "Amoklavin 1000 mg film tablet" and
 * "amoklavin" fold to the same thing.
 */
export function foldName(value: string): string {
  return value
    .replace(/[İIıi]/g, 'i')
    .toLowerCase()
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Strengths, forms and packaging — none of them tell drugs apart. */
const NOISE =
  /\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|g|ml|iu|ünite|unite|%)?\b|\b(tablet|tb|kapsul|kapsül|film|kaplı|kapli|surup|şurup|ampul|flakon|efervesan|forte|retard|sr|xr|mr)\b/g;

function tokens(value: string): string {
  return foldName(value.replace(NOISE, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * The lookup, built once.
 *
 * Longest name first, so "amoksisilin klavulanat" wins over "amoksisilin" —
 * they are different products with different interaction profiles, and matching
 * the shorter one first would file every co-amoxiclav under plain amoxicillin.
 */
const BY_NAME: { name: string; code: string }[] = INGREDIENTS.flatMap((ingredient) =>
  ingredient.names.map((name) => ({ name: tokens(name), code: ingredient.code })),
).sort((a, b) => b.name.length - a.name.length);

/** The ingredient a written drug name refers to, or null when it is not known. */
export function identify(drugName: string): string | null {
  const folded = tokens(drugName);

  if (folded.length === 0) return null;

  for (const entry of BY_NAME) {
    if (folded === entry.name) return entry.code;
  }

  // Then as a whole word inside the name: a prescription is often written
  // "Amoklavin BID 1000mg", and the brand is one token of several.
  for (const entry of BY_NAME) {
    const pattern = new RegExp(`(^| )${escapeRegExp(entry.name)}( |$)`);
    if (pattern.test(folded)) return entry.code;
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const RULES = new Map<string, { severity: Severity; note: string }>(
  INTERACTIONS.map((rule) => [key(rule.pair[0], rule.pair[1]), { severity: rule.severity, note: rule.note }]),
);

/** Order-independent, because an interaction is not directional. */
function key(a: string, b: string): string {
  return [a, b].sort().join('|');
}

const ORDER: Record<Severity, number> = {
  CONTRAINDICATED: 0,
  MAJOR: 1,
  MODERATE: 2,
  MINOR: 3,
};

/**
 * Every known interaction among a list of medications.
 *
 * Warnings are advisory and this never refuses a prescription: a clinician may
 * knowingly prescribe an interacting pair — dual antiplatelet therapy is a
 * treatment, not a mistake — and software that blocked it would be overruling
 * a decision it cannot see the reasons for. What it must do is say so, in
 * order of severity, where it cannot be missed.
 */
export function check(medications: Prescribed[]): InteractionCheck {
  const identified: { drug: Prescribed; code: string }[] = [];
  const unrecognised: Prescribed[] = [];

  for (const drug of medications) {
    const code = identify(drug.drugName);

    if (code === null) unrecognised.push(drug);
    else identified.push({ drug, code });
  }

  const warnings: InteractionWarning[] = [];
  let comparedPairs = 0;

  for (let i = 0; i < identified.length; i += 1) {
    for (let j = i + 1; j < identified.length; j += 1) {
      const left = identified[i]!;
      const right = identified[j]!;

      // The same ingredient twice is a duplicate, not an interaction — worth
      // seeing, but it is a different kind of finding and not this one's.
      if (left.code === right.code) continue;

      comparedPairs += 1;

      const rule = RULES.get(key(left.code, right.code));
      if (!rule) continue;

      warnings.push({
        severity: rule.severity,
        note: rule.note,
        ingredients: [left.code, right.code],
        between: [left.drug, right.drug],
      });
    }
  }

  return {
    warnings: warnings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]),
    unrecognised,
    comparedPairs,
  };
}

/**
 * Whether the check found anything a clinician has to be shown before they
 * carry on.
 *
 * Contraindicated and major only. Everything is shown; this decides what
 * interrupts, and interrupting on a minor interaction is how a clinic learns to
 * dismiss the dialog without reading it.
 */
export function isSevere(warning: InteractionWarning): boolean {
  return warning.severity === 'CONTRAINDICATED' || warning.severity === 'MAJOR';
}

/** The same ingredient prescribed twice under two names. */
export function duplicates(medications: Prescribed[]): Prescribed[][] {
  const byCode = new Map<string, Prescribed[]>();

  for (const drug of medications) {
    const code = identify(drug.drugName);
    if (code === null) continue;

    byCode.set(code, [...(byCode.get(code) ?? []), drug]);
  }

  return [...byCode.values()].filter((group) => group.length > 1);
}
