import { instantAt, localDate, type LocalDate } from '../common/local-calendar';

/**
 * Turning a prescription into a list of moments (spec M9).
 *
 * The specification asks for RFC 5545 recurrence rules, and the reason is worth
 * stating: "twice a day for eight days", "every other day", "Mondays and
 * Thursdays" and "three times a day until the 20th" are all ordinary
 * prescriptions, and an interval column expresses none of them.
 *
 * This implements the subset those sentences need, and refuses the rest rather
 * than guessing. A rule this cannot read is a rule a clinician wrote expecting
 * something to happen, so it is rejected at the point of writing rather than
 * quietly expanded into the wrong schedule.
 */

export type Frequency = 'DAILY' | 'WEEKLY' | 'HOURLY';

/** Monday-first, matching RFC 5545's two-letter codes. */
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export interface Recurrence {
  freq: Frequency;
  interval: number;
  count: number | null;
  until: Date | null;
  /** Hours of the day a dose falls on. Defaults to the start time's hour. */
  byHour: number[];
  byMinute: number[];
  /** Weekdays, for FREQ=WEEKLY. Empty means "the start date's weekday". */
  byDay: Weekday[];
}

export class RecurrenceError extends Error {}

/**
 * A ceiling on how many doses one prescription can generate.
 *
 * A rule with no COUNT, no UNTIL and no end date is not a prescription, it is a
 * loop. Six hundred is about a year of three-times-daily, which is longer than
 * any course this system is for.
 */
export const MAX_OCCURRENCES = 600;

const FREQUENCIES = new Set<string>(['DAILY', 'WEEKLY', 'HOURLY']);
const WEEKDAY_SET = new Set<string>(WEEKDAYS);

/**
 * Parses the subset, and refuses everything else by name.
 *
 * The error says which part it could not read, because the person who sees it
 * is a clinician who has just written a prescription and needs to know which
 * word to change.
 */
export function parseRule(rule: string): Recurrence {
  const parts = rule
    .replace(/^RRULE:/i, '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    throw new RecurrenceError('The recurrence rule is empty');
  }

  const fields = new Map<string, string>();

  for (const part of parts) {
    const [rawKey, ...rest] = part.split('=');
    const key = (rawKey ?? '').trim().toUpperCase();
    const value = rest.join('=').trim();

    if (key.length === 0 || value.length === 0) {
      throw new RecurrenceError(`Could not read "${part}" in the recurrence rule`);
    }

    fields.set(key, value);
  }

  const freq = (fields.get('FREQ') ?? '').toUpperCase();

  if (!FREQUENCIES.has(freq)) {
    throw new RecurrenceError(
      `This system understands FREQ=DAILY, WEEKLY or HOURLY; it was given "${freq || 'nothing'}"`,
    );
  }

  const interval = integer(fields.get('INTERVAL') ?? '1', 'INTERVAL');

  if (interval < 1) {
    throw new RecurrenceError('INTERVAL must be at least 1');
  }

  const count = fields.has('COUNT') ? integer(fields.get('COUNT')!, 'COUNT') : null;

  if (count !== null && count < 1) {
    throw new RecurrenceError('COUNT must be at least 1');
  }

  const until = fields.has('UNTIL') ? parseUntil(fields.get('UNTIL')!) : null;

  const byHour = list(fields.get('BYHOUR'), 'BYHOUR', 0, 23);
  const byMinute = list(fields.get('BYMINUTE'), 'BYMINUTE', 0, 59);
  const byDay = (fields.get('BYDAY') ?? '')
    .split(',')
    .map((day) => day.trim().toUpperCase())
    .filter((day) => day.length > 0);

  for (const day of byDay) {
    if (!WEEKDAY_SET.has(day)) {
      throw new RecurrenceError(`BYDAY does not understand "${day}"`);
    }
  }

  if (byDay.length > 0 && freq !== 'WEEKLY') {
    throw new RecurrenceError('BYDAY is only supported with FREQ=WEEKLY');
  }

  // A rule that is bounded by neither a count nor a date has to be bounded by
  // the medication's end date, and the caller is told to supply one.
  return {
    freq: freq as Frequency,
    interval,
    count,
    until,
    byHour,
    byMinute,
    byDay: byDay as Weekday[],
  };
}

function integer(value: string, field: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new RecurrenceError(`${field} must be a whole number, not "${value}"`);
  }

  return parsed;
}

function list(value: string | undefined, field: string, min: number, max: number): number[] {
  if (value === undefined) return [];

  const numbers = value.split(',').map((part) => integer(part.trim(), field));

  for (const number of numbers) {
    if (number < min || number > max) {
      throw new RecurrenceError(`${field} must be between ${min} and ${max}`);
    }
  }

  return [...new Set(numbers)].sort((a, b) => a - b);
}

/** `20260315T090000Z` or `20260315`. */
function parseUntil(value: string): Date {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value.trim());

  if (!match) {
    throw new RecurrenceError(`UNTIL must look like 20260315 or 20260315T090000Z, not "${value}"`);
  }

  const [, year, month, day, hour, minute, second] = match;

  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour ?? '23'),
      Number(minute ?? '59'),
      Number(second ?? '59'),
    ),
  );
}

export interface ExpandOptions {
  /** The first day of the course, as a local date in the patient's zone. */
  start: LocalDate;
  /** Wall-clock hour and minute the first dose falls on. */
  startHour: number;
  startMinute: number;
  /** The patient's timezone, not the clinic's — a dose is a wall-clock event. */
  timezone: string;
  /** Nothing after this instant, whatever the rule says. */
  endsAt?: Date | null;
}

/**
 * Every moment a dose is due.
 *
 * Expanded in the patient's own wall-clock time and converted to instants at
 * the end. A course that spans a daylight-saving change keeps its nine
 * o'clock: computing in UTC and adding twenty-four hours would move every dose
 * after the change by an hour, which for a twice-daily antibiotic is the
 * difference between eight hours apart and seven.
 */
export function expand(rule: Recurrence, options: ExpandOptions): Date[] {
  const hours = rule.byHour.length > 0 ? rule.byHour : [options.startHour];
  const minutes = rule.byMinute.length > 0 ? rule.byMinute : [options.startMinute];

  const occurrences: Date[] = [];
  const limit = rule.count ?? MAX_OCCURRENCES;

  if (rule.freq === 'HOURLY') {
    // Hourly is a step in real time rather than a wall-clock date, so it is the
    // one frequency where adding hours to an instant is the correct thing.
    let at = instantAt(options.start, options.startHour, options.timezone);
    at = new Date(at.getTime() + options.startMinute * 60_000);

    while (occurrences.length < limit && occurrences.length < MAX_OCCURRENCES) {
      if (!within(at, rule.until, options.endsAt)) break;
      occurrences.push(new Date(at));
      at = new Date(at.getTime() + rule.interval * 60 * 60 * 1000);
    }

    return occurrences;
  }

  const wanted = rule.byDay.length > 0 ? new Set<string>(rule.byDay) : null;
  let day = options.start;
  let steps = 0;

  while (occurrences.length < limit && steps < MAX_OCCURRENCES * 2) {
    steps += 1;

    const include =
      rule.freq === 'DAILY' ? true : wanted === null || wanted.has(weekdayOf(day, options.timezone));

    if (include) {
      for (const hour of hours) {
        for (const minute of minutes) {
          if (occurrences.length >= limit) break;

          const at = new Date(
            instantAt(day, hour, options.timezone).getTime() + minute * 60_000,
          );

          // A rule with BYHOUR can put the first slot before the start time on
          // day one; a course does not begin before it was written.
          if (at < instantAt(options.start, options.startHour, options.timezone)) continue;
          if (!within(at, rule.until, options.endsAt)) return occurrences;

          occurrences.push(at);
        }
      }
    }

    day = advance(day, rule, options.timezone);
  }

  return occurrences.sort((a, b) => a.getTime() - b.getTime()).slice(0, MAX_OCCURRENCES);
}

function within(at: Date, until: Date | null, endsAt: Date | null | undefined): boolean {
  if (until !== null && at > until) return false;
  if (endsAt !== null && endsAt !== undefined && at > endsAt) return false;

  return true;
}

/**
 * The next day the rule steps to.
 *
 * A weekly rule with BYDAY walks day by day and lets the filter decide, because
 * "Mondays and Thursdays, every other week" is two different steps and stepping
 * by weeks would skip one of them.
 */
function advance(day: LocalDate, rule: Recurrence, timezone: string): LocalDate {
  const step = rule.freq === 'DAILY' ? rule.interval : rule.byDay.length > 0 ? 1 : 7 * rule.interval;

  return addLocalDays(day, step, timezone);
}

function addLocalDays(day: LocalDate, days: number, timezone: string): LocalDate {
  // Through noon, so a day whose midnight does not exist (a spring-forward
  // zone) still lands on the intended date.
  const noon = instantAt(day, 12, timezone);

  return localDate(new Date(noon.getTime() + days * 24 * 60 * 60 * 1000), timezone);
}

function weekdayOf(day: LocalDate, timezone: string): Weekday {
  const at = instantAt(day, 12, timezone);
  const name = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short' }).format(at);

  const index = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(name);

  return WEEKDAYS[index === -1 ? 0 : index]!;
}

/** A sentence a clinician can check the rule against before saving it. */
export function describe(rule: Recurrence): string {
  const perDay = Math.max(1, rule.byHour.length || 1) * Math.max(1, rule.byMinute.length || 1);

  const cadence =
    rule.freq === 'HOURLY'
      ? `${rule.interval} saatte bir`
      : rule.freq === 'DAILY'
        ? rule.interval === 1
          ? `günde ${perDay}`
          : `${rule.interval} günde bir, ${perDay} kez`
        : rule.byDay.length > 0
          ? `${rule.byDay.join(', ')} günleri`
          : `${rule.interval} haftada bir`;

  const bound =
    rule.count !== null
      ? `${rule.count} doz`
      : rule.until !== null
        ? `${rule.until.toISOString().slice(0, 10)} tarihine kadar`
        : 'bitiş tarihine kadar';

  return `${cadence}, ${bound}`;
}
