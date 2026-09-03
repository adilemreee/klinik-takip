import { MedicationLogStatus } from '@prisma/client';
import { localDate } from '../common/local-calendar';

/**
 * How well a patient is keeping to their medication, and how to say so (M9).
 *
 * The specification asks for an adherence percentage, a streak, badges and a
 * warning below seventy per cent — and then adds the constraint that actually
 * shapes this file: the tone must stay restrained and must not undercut the
 * seriousness of the treatment.
 *
 * So there is no scolding here, no failure state, and no badge for anything a
 * patient could lose. What a patient sees when they are struggling is a number
 * and their doctor getting in touch, which is the thing that helps.
 */

/** The specification's threshold: below this the clinic is told (M9). */
export const LOW_ADHERENCE = 0.7;

/**
 * How long after a dose is due before an unanswered one counts against the
 * score.
 *
 * Six hours: long enough that somebody who takes a morning pill at lunchtime
 * and marks it later is not penalised, short enough that a whole day of silence
 * shows up the same day. A dose is not counted at all before this — a plan
 * written this morning must not read as nought per cent this afternoon, which
 * would send every new patient's clinic a low-adherence warning on day one.
 */
export const GRACE_HOURS = 6;

export interface DoseLog {
  scheduledAt: Date;
  status: MedicationLogStatus;
  takenAt: Date | null;
}

export interface Adherence {
  /** 0–1 over the doses that have come due, or null when none have. */
  score: number | null;
  taken: number;
  missed: number;
  /** Doses that have come due and been answered one way or the other. */
  due: number;
  /** Still ahead: not counted, not missed. */
  upcoming: number;
  /** Consecutive days, ending today, with every due dose taken. */
  streak: number;
}

function isTaken(status: MedicationLogStatus): boolean {
  // Late is still taken. A patient who took the eight o'clock dose at eleven
  // took it, and scoring that as a miss teaches them the app is not worth
  // being honest with.
  return status === MedicationLogStatus.TAKEN || status === MedicationLogStatus.LATE;
}

/**
 * Whether a dose has been waiting long enough to count.
 *
 * A snoozed dose is still pending: the patient said "later", and later has not
 * arrived until the grace period has.
 */
function isDue(log: DoseLog, now: Date): boolean {
  return log.scheduledAt.getTime() + GRACE_HOURS * 60 * 60 * 1000 <= now.getTime();
}

export function summarise(logs: DoseLog[], now = new Date(), timezone = 'Europe/Istanbul'): Adherence {
  let taken = 0;
  let missed = 0;
  let upcoming = 0;

  for (const log of logs) {
    if (isTaken(log.status)) {
      taken += 1;
      continue;
    }

    if (!isDue(log, now)) {
      upcoming += 1;
      continue;
    }

    missed += 1;
  }

  const due = taken + missed;

  return {
    // Null rather than zero when nothing has come due yet. Zero would read as
    // "this patient takes nothing", and it is the number the warning fires on.
    score: due === 0 ? null : taken / due,
    taken,
    missed,
    due,
    upcoming,
    streak: streakOf(logs, now, timezone),
  };
}

/**
 * Consecutive days, counting back from today, on which every due dose was taken.
 *
 * Today counts only once its doses have been answered — a streak that resets at
 * midnight and rebuilds through the morning would show a patient losing a
 * fortnight's run at breakfast.
 */
export function streakOf(logs: DoseLog[], now = new Date(), timezone = 'Europe/Istanbul'): number {
  const byDay = new Map<string, { taken: number; missed: number }>();

  for (const log of logs) {
    if (!isTaken(log.status) && !isDue(log, now)) continue;

    const day = key(localDate(log.scheduledAt, timezone));
    const tally = byDay.get(day) ?? { taken: 0, missed: 0 };

    if (isTaken(log.status)) tally.taken += 1;
    else tally.missed += 1;

    byDay.set(day, tally);
  }

  const days = [...byDay.keys()].sort().reverse();
  let streak = 0;

  for (const day of days) {
    const tally = byDay.get(day)!;

    if (tally.missed > 0) break;
    if (tally.taken === 0) break;

    streak += 1;
  }

  return streak;
}

function key(date: { year: number; month: number; day: number }): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/**
 * The badges, and the reason there are so few of them.
 *
 * M9 asks for gamification "without overdoing it and without undercutting the
 * medical seriousness". A course of antibiotics is not a game with a high
 * score, and a patient who misses doses because they feel unwell is not losing.
 *
 * So: every badge is earned by taking medicine, none is lost once earned, and
 * none of them mentions a miss. There is nothing here to be sad about.
 */
export const BADGES = [
  { id: 'first-dose', streak: 0, taken: 1 },
  { id: 'three-days', streak: 3, taken: 0 },
  { id: 'one-week', streak: 7, taken: 0 },
  { id: 'four-weeks', streak: 28, taken: 0 },
] as const;

export type BadgeId = (typeof BADGES)[number]['id'];

export function badgesFor(adherence: Adherence): BadgeId[] {
  return BADGES.filter(
    (badge) => adherence.streak >= badge.streak && adherence.taken >= badge.taken,
  ).map((badge) => badge.id);
}

/**
 * Whether the clinic should be told (M9: below seventy per cent).
 *
 * Two guards around the threshold, and both exist because of a false alarm the
 * clinic would learn to ignore:
 *
 *   - Nothing due yet means no score and no warning.
 *   - A handful of doses is not a pattern. One missed dose out of two is
 *     thirty-three per cent and means nothing; the same rate over a fortnight
 *     is the thing this warning is for.
 */
export const MIN_DOSES_BEFORE_WARNING = 6;

export function needsAttention(adherence: Adherence): boolean {
  if (adherence.score === null) return false;
  if (adherence.due < MIN_DOSES_BEFORE_WARNING) return false;

  return adherence.score < LOW_ADHERENCE;
}

/**
 * Whether the prescription is running out (M9: two days before the end).
 *
 * Counted in doses left rather than days, because "two days" of a
 * three-times-daily course and of a once-weekly one are not the same amount of
 * medicine — and it is the medicine that runs out.
 */
export function needsRenewal(logs: DoseLog[], now = new Date()): boolean {
  const remaining = logs.filter((log) => log.scheduledAt > now);

  if (remaining.length === 0) return false;

  const last = remaining.reduce((latest, log) =>
    log.scheduledAt > latest.scheduledAt ? log : latest,
  );

  const twoDays = 2 * 24 * 60 * 60 * 1000;

  return last.scheduledAt.getTime() - now.getTime() <= twoDays;
}
