import type { OcrLine } from './ocr-engine';

export interface ReferenceRange {
  low?: number;
  high?: number;
}

export interface LabCandidate {
  /** The analyte name exactly as it was printed, before any mapping. */
  rawName: string;
  value: number;
  unit: string;
  reference?: ReferenceRange;
  /** The engine's confidence in the weakest word on this line. */
  confidence: number;
  /** The line it came from, so a reviewer can see the original. */
  sourceLine: string;
}

/**
 * Units a lab report actually prints. An allow-list rather than a pattern:
 * "12 - 16" following a value could be a reference range or a date, and only
 * knowing what a unit looks like tells them apart.
 */
const UNITS = [
  'g/dL',
  'g/L',
  'mg/dL',
  'mg/L',
  'µg/dL',
  'ug/dL',
  'ng/mL',
  'pg/mL',
  'mmol/L',
  'µmol/L',
  'umol/L',
  'mEq/L',
  'U/L',
  'IU/L',
  'mIU/L',
  'mU/L',
  '10^3/µL',
  '10^3/uL',
  '10^6/µL',
  '10^6/uL',
  'K/µL',
  'K/uL',
  'M/µL',
  'fL',
  'pg',
  '%',
  'mm/h',
  'mm/sa',
  's',
  'sn',
];

/**
 * Longest first, so "mg/dL" is not matched as "g/L" inside it.
 *
 * The caret is written as a character class because engines routinely read
 * `10^3/µL` as `10*3/uL` — a superscript marker is a small mark and OCR is bad
 * at small marks. Refusing to match it would silently drop the whole haemogram.
 */
const UNIT_PATTERN = UNITS.slice()
  .sort((a, b) => b.length - a.length)
  .map((unit) => escape(unit).replace(/\\\^/g, '[\\^*]'))
  .join('|');

/**
 * A number as a lab report prints it: 13.5, 13,5, 1.234,5 or 1,234.5.
 *
 * Both separators appear because reports come from many countries — which is
 * the entire premise of a health-tourism clinic.
 */
const NUMBER = String.raw`\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;

const VALUE_WITH_UNIT = new RegExp(
  // Not \b after the unit: "%" is not a word character, so a word boundary
  // there fails on exactly the unit half a haematology panel is printed in.
  String.raw`^(?<name>.*?)[\s:.]*(?<value>${NUMBER})\s*(?<unit>${UNIT_PATTERN})(?![A-Za-z0-9])(?<rest>.*)$`,
  'i',
);

const RANGE_BETWEEN = new RegExp(
  String.raw`(?<low>${NUMBER})\s*(?:-|–|—|to|ile)\s*(?<high>${NUMBER})`,
  'i',
);
const RANGE_BELOW = new RegExp(String.raw`[<≤]\s*(?<high>${NUMBER})`);
const RANGE_ABOVE = new RegExp(String.raw`[>≥]\s*(?<low>${NUMBER})`);

/**
 * Turns OCR lines into candidate lab results.
 *
 * Deliberately conservative: a line that does not clearly carry a value and a
 * recognised unit is skipped rather than guessed at. A missing result is a
 * doctor typing one number; an invented one is a wrong number in a clinical
 * record that looks exactly as trustworthy as a right one.
 *
 * Nothing produced here is clinical until a human confirms it (spec M16).
 */
export function parseLabLines(lines: OcrLine[]): LabCandidate[] {
  const candidates: LabCandidate[] = [];

  for (const line of lines) {
    const candidate = parseLine(line);
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

function parseLine(line: OcrLine): LabCandidate | null {
  const match = VALUE_WITH_UNIT.exec(line.text.trim());
  if (!match?.groups) return null;

  const rawName = cleanName(match.groups.name ?? '');
  if (rawName.length < 2) return null;

  // A name that is only digits and punctuation is a table row number or a date,
  // not an analyte.
  if (!/[a-zçğıöşü]/i.test(rawName)) return null;

  const value = toNumber(match.groups.value ?? '');
  if (value === null) return null;

  return {
    rawName,
    value,
    unit: normaliseUnit(match.groups.unit ?? ''),
    reference: parseReference(match.groups.rest ?? ''),
    confidence: line.confidence,
    sourceLine: line.text.trim(),
  };
}

/** The reference range, when the line carries one after the value. */
export function parseReference(text: string): ReferenceRange | undefined {
  const between = RANGE_BETWEEN.exec(text);
  if (between?.groups) {
    const low = toNumber(between.groups.low ?? '');
    const high = toNumber(between.groups.high ?? '');

    // A range whose ends are the wrong way round was misread; reporting it
    // would flag every value in it as abnormal.
    if (low !== null && high !== null && low <= high) {
      return { low, high };
    }

    return undefined;
  }

  const below = RANGE_BELOW.exec(text);
  if (below?.groups) {
    const high = toNumber(below.groups.high ?? '');
    return high === null ? undefined : { high };
  }

  const above = RANGE_ABOVE.exec(text);
  if (above?.groups) {
    const low = toNumber(above.groups.low ?? '');
    return low === null ? undefined : { low };
  }

  return undefined;
}

/**
 * Reads a printed number.
 *
 * The separator is decided by position, not by locale: in "1.234,5" the comma
 * is last and therefore decimal, and in "1,234.5" the dot is. Guessing from the
 * device's locale would misread every report printed abroad, which here is most
 * of them.
 */
export function toNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  const lastDot = trimmed.lastIndexOf('.');
  const lastComma = trimmed.lastIndexOf(',');

  let normalised: string;

  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const grouping = decimal === '.' ? ',' : '.';
    normalised = trimmed.split(grouping).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    // A lone comma with exactly three digits after it is ambiguous — 1,234 is
    // a thousand in one country and 1.234 in another. Refusing beats picking:
    // an unread value is typed in, a misread one is believed.
    normalised = /,\d{3}$/.test(trimmed) ? '' : trimmed.replace(',', '.');
  } else {
    normalised = trimmed;
  }

  if (normalised === '') return null;

  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

/** Strips table furniture and OCR debris from the analyte name. */
function cleanName(name: string): string {
  return name
    .replace(/[|_*]+/g, ' ')
    .replace(/^[\s\d.)\]-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Micro and the superscript caret are each printed several ways and read as
 * several more; results are stored under one spelling so a trend chart does not
 * split into two series because of how one report was scanned.
 */
function normaliseUnit(unit: string): string {
  return unit
    .replace(/\*/g, '^')
    .replace(/^u(?=g|mol)/i, 'µ')
    .replace(/\bu(?=L\b)/i, 'µ');
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
