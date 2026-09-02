/**
 * Wall-clock time in somebody else's timezone.
 *
 * Both the messaging access window and notification quiet hours are ranges a
 * person set in local time — "18:00 to 20:00", "22:00 to 08:00" — and both have
 * to be read in the timezone they were written in. Shared so the two cannot
 * drift: a bug in one would otherwise be fixed once and left in the other.
 */

/** Minutes since midnight, or null when the text is not a wall-clock time. */
export function parseTime(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/**
 * The local day and minute-of-day for a moment.
 *
 * Computed through Intl rather than by adding an offset, because the offset is
 * not a constant: clinics elsewhere change their clocks, and a range that
 * silently shifts by an hour twice a year is a range nobody trusts.
 */
export function localParts(at: Date, timezone: string): { day: number; minutes: number } {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(at);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return {
    day: Math.max(0, days.indexOf(weekday)),
    // 24:00 is midnight of the next day in some locales' output; clamp so a
    // moment can never land outside the day it belongs to.
    minutes: (hour % 24) * 60 + minute,
  };
}

/**
 * Whether a moment falls inside a daily range.
 *
 * A range that wraps past midnight — 22:00 to 08:00 — is the normal case for
 * quiet hours, so it is handled here rather than at each call site.
 */
export function withinDailyRange(
  minutes: number,
  startTime: string,
  endTime: string,
): boolean | null {
  const start = parseTime(startTime);
  const end = parseTime(endTime);

  // Unreadable: the caller decides what to do, because "inside" and "outside"
  // mean opposite things to a window and to quiet hours.
  if (start === null || end === null) return null;

  if (start <= end) {
    return minutes >= start && minutes < end;
  }

  return minutes >= start || minutes < end;
}
