import { localParts, withinDailyRange } from '../common/wall-clock';

export interface Slot {
  startsAt: Date;
  durationMinutes: number;
}

export interface AvailabilitySpec {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string;
  isActive: boolean;
}

/** Two appointments clash when they overlap at all, for the same staff member. */
export function overlaps(a: Slot, b: Slot): boolean {
  const aStart = a.startsAt.getTime();
  const aEnd = aStart + a.durationMinutes * 60_000;
  const bStart = b.startsAt.getTime();
  const bEnd = bStart + b.durationMinutes * 60_000;

  // Touching is not overlapping: a 10:00–10:30 and a 10:30–11:00 are the normal
  // way a clinic fills a morning, and refusing that would leave a gap between
  // every pair of appointments.
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Whether a slot falls entirely inside the staff member's availability.
 *
 * Entirely, not partly: an appointment that starts at 17:45 in a clinic that
 * closes at 18:00 is a half-hour appointment with fifteen minutes of it after
 * closing, and booking it puts somebody in an empty building.
 *
 * No windows at all means unavailable — the opposite of the messaging access
 * window, and for the opposite reason. There, silence means the clinic never
 * asked for messages to be held; here, a doctor who has published no hours has
 * not offered any, and inventing some would book patients into time nobody
 * agreed to.
 */
export function withinAvailability(slot: Slot, windows: AvailabilitySpec[]): boolean {
  const active = windows.filter((window) => window.isActive);
  if (active.length === 0) return false;

  const end = new Date(slot.startsAt.getTime() + slot.durationMinutes * 60_000);

  return active.some((window) => {
    const covers = (at: Date, inclusiveEnd: boolean): boolean => {
      const { day, minutes } = localParts(at, window.timezone);
      if (day !== window.dayOfWeek) return false;

      const within = withinDailyRange(minutes, window.startTime, window.endTime);
      if (within === null) return false;

      if (within) return true;

      // The closing minute itself: an appointment may end exactly at 18:00
      // even though 18:00 is not a bookable start.
      if (!inclusiveEnd) return false;

      const closing = window.endTime.trim();
      const [hours, mins] = closing.split(':').map(Number);

      return minutes === (hours ?? 0) * 60 + (mins ?? 0);
    };

    return covers(slot.startsAt, false) && covers(end, true);
  });
}

/**
 * The reminders an appointment gets, and how far ahead (spec M10).
 *
 * ISO-8601 durations because they are what the row stores, and storing the
 * label rather than a computed time means a rescheduled appointment does not
 * re-send the reminders it has already sent.
 */
export const REMINDER_OFFSETS: { id: string; minutesBefore: number }[] = [
  { id: 'P7D', minutesBefore: 7 * 24 * 60 },
  { id: 'P1D', minutesBefore: 24 * 60 },
  { id: 'PT2H', minutesBefore: 2 * 60 },
];

/**
 * Which reminders are due for an appointment now.
 *
 * A reminder whose moment has passed is not sent late: a "in two hours" message
 * that arrives after the appointment is worse than none, because it tells the
 * patient something that is no longer true.
 */
export function dueReminders(
  scheduledAt: Date,
  alreadySent: string[],
  now: Date,
): string[] {
  const sent = new Set(alreadySent);

  return REMINDER_OFFSETS.filter((offset) => {
    if (sent.has(offset.id)) return false;

    const fireAt = scheduledAt.getTime() - offset.minutesBefore * 60_000;

    // Due once its moment has arrived, and only while the appointment is still
    // ahead.
    return now.getTime() >= fireAt && now.getTime() < scheduledAt.getTime();
  }).map((offset) => offset.id);
}
