import { LabFlag, RiskLevel } from '@prisma/client';

/**
 * Turning a verified lab panel into something a model can read, and reading its
 * answer back (spec M5).
 *
 * Kept pure and separate from the service for the usual reason, and one more:
 * what goes into the prompt is the whole of what leaves the building, so it
 * should be inspectable in a test rather than assembled inside a method that
 * also talks to four other things.
 */

export interface PanelResult {
  analyteName: string;
  value: number;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  flag: LabFlag | null;
  measuredAt: Date;
}

/**
 * How many results one report covers.
 *
 * A full metabolic panel is around forty analytes. Past that a "panel" is
 * really several visits stacked together, and asking the model to interpret a
 * year of results as one moment produces a summary that is wrong about time.
 */
export const MAX_RESULTS = 40;

/**
 * Ordered so that what matters is at the top, and truncation — if it happens —
 * takes the normal values rather than the critical ones.
 */
const FLAG_ORDER: Record<string, number> = {
  [LabFlag.CRITICAL]: 0,
  [LabFlag.HIGH]: 1,
  [LabFlag.LOW]: 2,
  [LabFlag.NORMAL]: 3,
};

export function selectResults(results: PanelResult[]): PanelResult[] {
  return [...results]
    .sort((a, b) => {
      const byFlag =
        (FLAG_ORDER[a.flag ?? LabFlag.NORMAL] ?? 4) - (FLAG_ORDER[b.flag ?? LabFlag.NORMAL] ?? 4);

      return byFlag !== 0 ? byFlag : a.analyteName.localeCompare(b.analyteName, 'tr');
    })
    .slice(0, MAX_RESULTS);
}

/**
 * The panel as text, one result per line, columns separated by a pipe.
 *
 * The separator is not a space or a dash on purpose: those are what the
 * identifier scan treats as part of a run of digits, and a panel written with
 * them can splice two innocent values into something that looks like a phone
 * number. A pipe ends every run at the column boundary.
 */
export function renderPanel(results: PanelResult[]): string {
  const lines = results.map((result) => {
    const range =
      result.refLow !== null && result.refHigh !== null
        ? `${result.refLow}-${result.refHigh}`
        : result.refLow !== null
          ? `>${result.refLow}`
          : result.refHigh !== null
            ? `<${result.refHigh}`
            : 'referans yok';

    return [
      result.analyteName,
      String(result.value),
      result.unit,
      range,
      result.flag ?? 'NORMAL',
    ].join(' | ');
  });

  return ['Analit | Değer | Birim | Referans | Durum', ...lines].join('\n');
}

export interface LabInterpretation {
  /** Clinical, for the doctor. */
  doctorMd: string;
  /** Plain language, for the patient. Informative, never a diagnosis. */
  patientMd: string;
  riskLevel: RiskLevel;
}

const RISKS = new Set<string>(Object.values(RiskLevel));

/**
 * Reads the model's answer, and returns nothing rather than a guess.
 *
 * Same rule as the triage parser and for the same reason: a parser with a
 * default risk level has quietly become the thing that decides how alarming a
 * result is. A report that cannot be read is a report that is not produced.
 */
export function parseInterpretation(raw: string): LabInterpretation | null {
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
  const risk = typeof record.riskLevel === 'string' ? record.riskLevel.trim().toUpperCase() : '';

  if (!RISKS.has(risk)) return null;

  const doctorMd = text(record.doctorMd);
  const patientMd = text(record.patientMd);

  // Both renderings or neither. A report with only the clinical half would be
  // released to a patient as an empty page; one with only the plain half leaves
  // the doctor reading the patient's version as if it were a clinical summary.
  if (doctorMd.length === 0 || patientMd.length === 0) return null;

  return { doctorMd, patientMd, riskLevel: risk as RiskLevel };
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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 8_000) : '';
}

/**
 * Whether a report may reach the patient without a clinician looking first.
 *
 * The specification makes review the rule and allows a clinic to switch it off
 * (M5). What is *not* offered is a mode that releases a HIGH or CRITICAL
 * interpretation unread: an AI telling a post-operative patient abroad that
 * something is seriously wrong, before anyone at the clinic has seen it, is the
 * one outcome none of the rest of this system would forgive.
 *
 * A clinic that wants that behaviour should have to ask for it in writing, not
 * find it behind a boolean.
 */
export function mayAutoRelease(risk: RiskLevel, autoReleaseLowRisk: boolean): boolean {
  if (!autoReleaseLowRisk) return false;

  return risk === RiskLevel.LOW || risk === RiskLevel.MEDIUM;
}

/** The warning the specification puts under every AI output (M5). */
export const AI_DISCLAIMER = {
  tr: 'Bu içerik yapay zeka tarafından üretilmiştir, tıbbi tanı yerine geçmez.',
  en: 'This content was produced by AI and is not a medical diagnosis.',
} as const;

export function disclaimerFor(language: string | null | undefined): string {
  const lang = (language ?? 'tr').slice(0, 2).toLowerCase();

  return lang === 'en' ? AI_DISCLAIMER.en : AI_DISCLAIMER.tr;
}
