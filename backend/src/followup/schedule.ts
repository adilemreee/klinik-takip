import { addDays, addMonths, instantAt, localDate } from '../common/local-calendar';
import { templateFor, type MilestoneSpec } from './templates';

/**
 * The hour a check-up reminder lands, in the clinic's local time.
 *
 * Ten in the morning, not the hour of the operation: an operation at 23:30
 * would otherwise give the patient a reminder at half past eleven at night,
 * every milestone, for a year.
 */
export const REMINDER_HOUR = 10;

export interface PlannedMilestone {
  label: string;
  dueAt: Date;
}

/**
 * Turns an operation date into the dates its check-ups fall on.
 *
 * Pure, because this is the part that can be wrong in a way nobody notices for
 * six months: a date that is one day out looks entirely plausible on a screen.
 */
export function planMilestones(
  surgeryDate: Date,
  template: string | null | undefined,
  timezone = 'Europe/Istanbul',
  hour = REMINDER_HOUR,
): PlannedMilestone[] {
  const start = localDate(surgeryDate, timezone);

  return templateFor(template).map((spec: MilestoneSpec) => {
    const date = spec.months !== undefined
      ? addMonths(start, spec.months)
      : addDays(start, spec.days ?? 0);

    return { label: spec.label, dueAt: instantAt(date, hour, timezone) };
  });
}
