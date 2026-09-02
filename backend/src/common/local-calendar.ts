/**
 * Calendar arithmetic in somebody else's timezone.
 *
 * Follow-up milestones are "one month after the operation", and both halves of
 * that are local: the month is a calendar month rather than thirty days, and
 * the hour the reminder lands is the clinic's hour, not the server's.
 */

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

/** The local calendar date of a moment. */
export function localDate(at: Date, timezone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);

  const value = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  return { year: value('year'), month: value('month'), day: value('day') };
}

/**
 * Adds calendar months, clamping to the end of the shorter month.
 *
 * An operation on 31 January has its one-month check a month later, which is
 * 28 February — not 3 March, which is what adding a month to a date does when
 * nobody thinks about it. Overflowing would move a check-up past the month it
 * belongs to, and by six months the drift is days.
 */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const zeroBased = date.month - 1 + months;
  const year = date.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12;

  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return { year, month: month + 1, day: Math.min(date.day, lastDay) };
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * The instant at which a local date reads a given hour in a timezone.
 *
 * Found by searching candidate offsets rather than by adding a fixed one: the
 * offset changes across a daylight-saving boundary, and a schedule generated in
 * winter for a check-up in summer would otherwise fire an hour out — quietly,
 * and only for half the year.
 */
export function instantAt(
  date: LocalDate,
  hour: number,
  timezone: string,
): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day, hour, 0, 0);

  // Offsets range roughly -12..+14 hours; a two-pass search settles it exactly,
  // because the first guess can land on the wrong side of a transition.
  let candidate = new Date(naive);

  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(candidate);

    const value = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value ?? '0');

    const asUtc = Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      value('hour') % 24,
      value('minute'),
    );

    const drift = naive - asUtc;
    if (drift === 0) return candidate;

    candidate = new Date(candidate.getTime() + drift);
  }

  return candidate;
}
