/**
 * Writing CSV (spec M12: toplu Excel/CSV export).
 *
 * Two things in here are not cosmetic.
 *
 * **Formula injection.** A spreadsheet treats a cell beginning with `=`, `+`,
 * `-` or `@` as a formula, and opens it as one. A patient types their own name
 * at registration, so `=HYPERLINK("http://…","Click")` in a name field becomes
 * a live link in the clinic's copy of the export, and worse things are
 * possible. Every value is neutralised before it is written.
 *
 * **The byte-order mark.** Excel opens a CSV without one as the local ANSI
 * codepage, and a Turkish clinic's export comes out as "AyÅŸe". Three bytes at
 * the front fix it, and no amount of correct UTF-8 does without them.
 */

/** Excel decides a cell is a formula from its first character. */
const FORMULA_START = /^[=+\-@\t\r]/;

export const BOM = '﻿';

/**
 * Neutralises a value that a spreadsheet would otherwise execute.
 *
 * A leading apostrophe is the conventional escape: Excel and LibreOffice both
 * read the cell as text and do not display the apostrophe. The value is kept
 * exactly as it was recorded — a phone number "+90 532…" still reads as itself,
 * which is why this is preferred to stripping the character.
 */
export function neutralise(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** One field, quoted when it has to be. */
export function escapeField(value: unknown, delimiter = ','): string {
  const text = stringify(value);
  const safe = neutralise(text);

  if (safe.includes(delimiter) || safe.includes('"') || /[\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }

  return safe;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  // The row builder produces primitives, so this is unreachable in practice —
  // but "[object Object]" in a cell is the kind of thing that ships.
  return JSON.stringify(value);
}

export function toRow(values: unknown[], delimiter = ','): string {
  // CRLF: the line ending every spreadsheet on every platform reads, which a
  // bare LF is not on the one that matters here.
  return `${values.map((value) => escapeField(value, delimiter)).join(delimiter)}\r\n`;
}

/**
 * The provenance block written above the headings.
 *
 * A spreadsheet in a shared folder with no provenance gets read as "all our
 * patients" whatever it actually contains. These lines say who asked, when,
 * with what filter, and — the one that matters most — whether the rows are the
 * whole answer.
 */
export function provenance(lines: [string, string][], delimiter = ','): string {
  return lines.map(([label, value]) => toRow([label, value], delimiter)).join('') +
    toRow([], delimiter);
}
