import { localDate, type LocalDate } from '../common/local-calendar';
import { parseTime } from '../common/wall-clock';

/**
 * The arithmetic behind the dashboard (spec M11, T6.4).
 *
 * A dashboard's characteristic failure is not a wrong sum, it is a **confident
 * ratio over a denominator nobody showed**. "Conversion 100%" from a single
 * enquiry, "Germany 33% of patients" from three files, an occupancy figure
 * computed against a working week that was never configured — each is
 * arithmetically correct and each will be read as something it is not.
 *
 * So every rate here carries the two numbers it came from, and a rate over too
 * few cases is `null` rather than a percentage.
 */

export interface LocalMonth {
  year: number;
  month: number;
}

/** `2026-03`, the key a chart's x-axis is built on. */
export function monthKey(month: LocalMonth): string {
  return `${month.year}-${String(month.month).padStart(2, '0')}`;
}

export function monthOf(at: Date, timezone: string): LocalMonth {
  const date = localDate(at, timezone);
  return { year: date.year, month: date.month };
}

/**
 * Every month the range touches, in the clinic's calendar, including empty
 * ones.
 *
 * The empty months matter: a chart that omits the month with no operations
 * draws a flat line through it, and a quiet August becomes invisible.
 */
export function monthsBetween(from: Date, to: Date, timezone: string): LocalMonth[] {
  const start = monthOf(from, timezone);
  const end = monthOf(to, timezone);
  const months: LocalMonth[] = [];

  let cursor = { ...start };

  // A guard rather than a `while (true)`: a reversed range would otherwise spin.
  for (let step = 0; step < MAX_MONTHS; step += 1) {
    if (cursor.year > end.year || (cursor.year === end.year && cursor.month > end.month)) break;

    months.push({ ...cursor });
    cursor =
      cursor.month === 12
        ? { year: cursor.year + 1, month: 1 }
        : { year: cursor.year, month: cursor.month + 1 };
  }

  return months;
}

/** Ten years of monthly buckets is already more than a chart can render. */
export const MAX_MONTHS = 120;

/**
 * Below this, a proportion is not reported.
 *
 * One enquiry that became one operation is not a hundred per cent conversion
 * rate, and printing it as one invites a decision — "cut the other channels" —
 * that the number cannot support. The counts are always returned, so the reader
 * can see two of three for themselves.
 */
export const MIN_FOR_RATE = 5;

/**
 * A proportion, or null when there are too few cases to have one.
 *
 * Null is not zero and clients must not render it as one: it means "not enough
 * to say", which is a different statement from "none".
 */
export function rateOf(part: number, whole: number): number | null {
  if (whole < MIN_FOR_RATE || whole <= 0) return null;

  return Math.round((part / whole) * 10000) / 10000;
}

/**
 * Folding for a free-text channel.
 *
 * `referral_source` is typed by whoever opened the file, so "Instagram",
 * "instagram", "INSTAGRAM " and "İnstagram" arrive as four channels and split
 * one channel's numbers four ways — the same failure as four spellings of a
 * drug name, with the same fix.
 *
 * Only casing, diacritics and spacing are folded. "Instagram reklam" is left
 * as its own channel: guessing that it belongs with "Instagram" would be this
 * module deciding what the clinic's marketing categories are.
 */
export function foldChannel(raw: string): string {
  return raw
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

/** The channel a patient with nothing recorded belongs to. */
export const UNKNOWN_CHANNEL = 'unknown';

/**
 * Groups values by their folded form, keeping the spelling used most often as
 * the label so the clinic sees its own words back.
 */
export function groupByFolded<T>(
  items: T[],
  valueOf: (item: T) => string | null,
): Map<string, { label: string; items: T[] }> {
  const groups = new Map<string, { spellings: Map<string, number>; items: T[] }>();

  for (const item of items) {
    const raw = valueOf(item)?.trim() ?? '';

    // Nothing recorded, or something that folds away to nothing ("---"), is
    // its own bucket rather than no bucket: dropping these would inflate every
    // other row's share of a total they are still part of.
    const key = raw === '' ? UNKNOWN_CHANNEL : foldChannel(raw) || UNKNOWN_CHANNEL;

    const group = groups.get(key) ?? { spellings: new Map<string, number>(), items: [] as T[] };
    group.items.push(item);

    if (raw !== '') {
      group.spellings.set(raw, (group.spellings.get(raw) ?? 0) + 1);
    }

    groups.set(key, group);
  }

  const labelled = new Map<string, { label: string; items: T[] }>();

  for (const [key, group] of groups) {
    // Most frequent wins; ties are broken by code unit rather than by
    // `localeCompare`, whose answer depends on the server's locale — the label
    // on a chart must not change because the process started somewhere else.
    // Code-unit order also happens to prefer "Berlin" to "berlin", which is
    // the spelling a person would want to read.
    const commonest = [...group.spellings.entries()].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    )[0];

    labelled.set(key, { label: commonest?.[0] ?? key, items: group.items });
  }

  return labelled;
}

export interface Window {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/**
 * How many minutes the clinic is open in a month.
 *
 * Counted in **wall clock**, deliberately. A window of 09:00–17:00 is eight
 * hours of working day whichever side of a daylight-saving change it falls, and
 * counting elapsed time instead would report the clocks-go-back Sunday as a
 * nine-hour day.
 *
 * Returns 0 when nothing is configured, which the caller must treat as "no
 * denominator" rather than "no capacity" — see `occupancyOf`.
 */
export function availableMinutesIn(month: LocalMonth, windows: Window[]): number {
  if (windows.length === 0) return 0;

  const byWeekday = new Map<number, number>();

  for (const window of windows) {
    const start = parseTime(window.startTime);
    const end = parseTime(window.endTime);

    // An unreadable or inverted window contributes nothing rather than a
    // negative capacity that would quietly inflate the occupancy rate.
    if (start === null || end === null || end <= start) continue;

    byWeekday.set(window.dayOfWeek, (byWeekday.get(window.dayOfWeek) ?? 0) + (end - start));
  }

  let total = 0;

  for (const [weekday, minutes] of byWeekday) {
    total += weekdayOccurrences(month, weekday) * minutes;
  }

  return total;
}

/** How many Mondays (etc.) fall in a calendar month. */
export function weekdayOccurrences(month: LocalMonth, weekday: number): number {
  const daysInMonth = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  let count = 0;

  for (let day = 1; day <= daysInMonth; day += 1) {
    if (new Date(Date.UTC(month.year, month.month - 1, day)).getUTCDay() === weekday) {
      count += 1;
    }
  }

  return count;
}

export interface Occupancy {
  bookedMinutes: number;
  availableMinutes: number;
  /**
   * Booked over available, or **null when there is no configured capacity**.
   *
   * A clinic that has not set its working hours has no denominator, and a
   * percentage without one is a fiction. Reporting nought per cent would be
   * worse: it reads as an empty diary rather than a missing setting.
   */
  rate: number | null;
}

export function occupancyOf(bookedMinutes: number, availableMinutes: number): Occupancy {
  return {
    bookedMinutes,
    availableMinutes,
    rate:
      availableMinutes <= 0
        ? null
        : Math.round((bookedMinutes / availableMinutes) * 10000) / 10000,
  };
}

/** The first instant of a local month, for querying. */
export function monthStart(month: LocalMonth): LocalDate {
  return { year: month.year, month: month.month, day: 1 };
}
