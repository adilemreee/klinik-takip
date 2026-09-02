/**
 * When the clinic is reachable (spec M3).
 *
 * A doctor defines hours — Monday to Friday, 18:00 to 20:00, say — and a
 * patient message written outside them is queued rather than delivered. The
 * point is not to silence patients: it is that a message which arrives at 3am
 * and is answered at 9am looks ignored for six hours, where one that says
 * "queued until 18:00" does not.
 *
 * The emergency button bypasses this entirely, which is why this module knows
 * nothing about it.
 */

export interface WindowSpec {
  /** 0 = Sunday .. 6 = Saturday, matching JavaScript's getDay. */
  dayOfWeek: number;
  /** Local wall-clock "HH:MM" in the clinic's timezone. */
  startTime: string;
  endTime: string;
  timezone: string;
  isActive: boolean;
}

export interface WindowState {
  open: boolean;
  /** When it next opens. Null when it is open now, or when no window exists. */
  opensAt: Date | null;
}

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
 * The clinic's local day and minute-of-day for a moment.
 *
 * Computed through Intl rather than by adding an offset, because the offset is
 * not a constant: Istanbul does not change clocks now but the setting is a
 * timezone and clinics elsewhere do, and a window that silently shifts by an
 * hour twice a year is a window nobody trusts.
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
 * Whether the clinic is reachable now, and when it next will be.
 *
 * No windows at all means always open. A clinic that has not configured hours
 * has not asked for messages to be held, and defaulting to closed would
 * silently swallow every message the day the feature shipped.
 */
export function windowState(windows: WindowSpec[], at: Date): WindowState {
  const active = windows.filter((window) => window.isActive);

  if (active.length === 0) {
    return { open: true, opensAt: null };
  }

  for (const window of active) {
    if (covers(window, at)) {
      return { open: true, opensAt: null };
    }
  }

  return { open: false, opensAt: nextOpening(active, at) };
}

function covers(window: WindowSpec, at: Date): boolean {
  const start = parseTime(window.startTime);
  const end = parseTime(window.endTime);

  // A window we cannot read is not a window. Treating it as covering
  // everything would open the clinic by accident; treating it as covering
  // nothing would close it. It is skipped, and the others decide.
  if (start === null || end === null) return false;

  const { day, minutes } = localParts(at, window.timezone);

  if (start <= end) {
    return day === window.dayOfWeek && minutes >= start && minutes < end;
  }

  // A window that wraps past midnight — 22:00 to 02:00 — belongs to two days.
  const previousDay = (window.dayOfWeek + 1) % 7;

  return (
    (day === window.dayOfWeek && minutes >= start) ||
    (day === previousDay && minutes < end)
  );
}

/**
 * The next moment a window opens, searched minute by minute over a week.
 *
 * A week and no further: if nothing opens within seven days the schedule is
 * effectively empty, and returning a date months away would show a patient a
 * promise the clinic never made.
 */
function nextOpening(windows: WindowSpec[], from: Date): Date | null {
  const step = 5 * 60 * 1000;
  const limit = 7 * 24 * 60 * 60 * 1000;

  // Aligned to the next five-minute boundary so the answer is a time a person
  // would say out loud rather than 18:03.
  let cursor = new Date(Math.ceil((from.getTime() + 1) / step) * step);

  for (let elapsed = 0; elapsed <= limit; elapsed += step) {
    for (const window of windows) {
      if (covers(window, cursor)) {
        return cursor;
      }
    }

    cursor = new Date(cursor.getTime() + step);
  }

  return null;
}
