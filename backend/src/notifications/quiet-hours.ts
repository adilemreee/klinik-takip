import { localParts, withinDailyRange } from '../common/wall-clock';

export interface QuietHours {
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string;
}

/**
 * Whether a moment falls inside somebody's quiet hours.
 *
 * A range with no start or no end is not quiet hours, it is an unfinished
 * setting, and treating half a range as a whole one would silence a patient's
 * notifications on the strength of a half-filled form.
 *
 * An unreadable range is treated as not quiet, deliberately. The two mistakes
 * are not equal: sending a notification that should have waited is a
 * disturbance, and withholding one that should have gone is a patient who never
 * hears about their result.
 */
export function inQuietHours(preference: QuietHours, at: Date): boolean {
  if (!preference.quietHoursStart || !preference.quietHoursEnd) return false;

  const { minutes } = localParts(at, preference.timezone);
  const within = withinDailyRange(
    minutes,
    preference.quietHoursStart,
    preference.quietHoursEnd,
  );

  return within ?? false;
}
