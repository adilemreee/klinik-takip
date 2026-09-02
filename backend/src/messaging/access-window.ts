import { localParts, parseTime } from '../common/wall-clock';

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

export { localParts, parseTime } from '../common/wall-clock';

export interface WindowState {
  open: boolean;
  /** When it next opens. Null when it is open now, or when no window exists. */
  opensAt: Date | null;
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
