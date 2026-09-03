import { MedicationLogStatus } from '@prisma/client';
import {
  BADGES,
  GRACE_HOURS,
  LOW_ADHERENCE,
  MIN_DOSES_BEFORE_WARNING,
  badgesFor,
  needsAttention,
  needsRenewal,
  streakOf,
  summarise,
  type DoseLog,
} from './adherence';
import {
  MAX_OCCURRENCES,
  RecurrenceError,
  describe as describeRule,
  expand,
  parseRule,
} from './recurrence';

const istanbul = 'Europe/Istanbul';
const berlin = 'Europe/Berlin';

const at = (iso: string): Date => new Date(iso);

const local = (date: Date, timezone = istanbul): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

const dose = (
  scheduledAt: string,
  status: MedicationLogStatus = MedicationLogStatus.PENDING,
): DoseLog => ({
  scheduledAt: at(scheduledAt),
  status,
  takenAt: status === MedicationLogStatus.TAKEN ? at(scheduledAt) : null,
});

/**
 * Turning a prescription into moments (spec M9).
 *
 * The thing that goes wrong here goes wrong quietly: a schedule an hour out for
 * half the year, or a twice-daily course that generated sixteen days of doses
 * because somebody read COUNT as days.
 */
describe('reading a recurrence rule', () => {
  it('reads the everyday prescription', () => {
    const rule = parseRule('FREQ=DAILY;INTERVAL=1;COUNT=8;BYHOUR=9,21');

    expect(rule.freq).toBe('DAILY');
    expect(rule.count).toBe(8);
    expect(rule.byHour).toEqual([9, 21]);
  });

  it('accepts the RRULE: prefix and stray whitespace', () => {
    expect(parseRule('RRULE:FREQ=DAILY; INTERVAL = 2 ').interval).toBe(2);
  });

  it('reads UNTIL in both forms', () => {
    expect(parseRule('FREQ=DAILY;UNTIL=20260315').until?.toISOString()).toBe(
      '2026-03-15T23:59:59.000Z',
    );
    expect(parseRule('FREQ=DAILY;UNTIL=20260315T090000Z').until?.toISOString()).toBe(
      '2026-03-15T09:00:00.000Z',
    );
  });

  it('reads weekdays for a weekly course', () => {
    expect(parseRule('FREQ=WEEKLY;BYDAY=MO,TH').byDay).toEqual(['MO', 'TH']);
  });

  /**
   * Refused by name rather than guessed at. A rule this cannot read is one a
   * clinician wrote expecting something to happen.
   */
  it('refuses a frequency it does not implement, and says which', () => {
    expect(() => parseRule('FREQ=MONTHLY;COUNT=3')).toThrow(RecurrenceError);
    expect(() => parseRule('FREQ=MONTHLY;COUNT=3')).toThrow(/MONTHLY/);
  });

  it('refuses nonsense rather than defaulting', () => {
    for (const rule of ['', 'FREQ=', 'DAILY', 'FREQ=DAILY;INTERVAL=0', 'FREQ=DAILY;COUNT=0']) {
      expect(() => parseRule(rule)).toThrow(RecurrenceError);
    }
  });

  it('refuses an hour that is not an hour', () => {
    expect(() => parseRule('FREQ=DAILY;BYHOUR=24')).toThrow(/BYHOUR/);
    expect(() => parseRule('FREQ=DAILY;BYMINUTE=61')).toThrow(/BYMINUTE/);
  });

  it('refuses BYDAY on a daily rule, where it would do nothing', () => {
    expect(() => parseRule('FREQ=DAILY;BYDAY=MO')).toThrow(/BYDAY/);
  });

  it('describes a rule in a sentence a clinician can check', () => {
    expect(describeRule(parseRule('FREQ=DAILY;COUNT=16;BYHOUR=9,21'))).toContain('günde 2');
    expect(describeRule(parseRule('FREQ=HOURLY;INTERVAL=8;COUNT=6'))).toContain('8 saatte bir');
    expect(describeRule(parseRule('FREQ=WEEKLY;BYDAY=MO,TH;COUNT=4'))).toContain('MO, TH');
  });
});

describe('expanding a course into doses', () => {
  const start = { year: 2026, month: 3, day: 2 };

  /** "Twice a day for eight days" is sixteen doses, not sixteen days. */
  it('gives twice a day for eight days as sixteen doses over eight days', () => {
    const doses = expand(parseRule('FREQ=DAILY;COUNT=16;BYHOUR=9,21'), {
      start,
      startHour: 9,
      startMinute: 0,
      timezone: istanbul,
    });

    expect(doses).toHaveLength(16);
    expect(local(doses[0]!)).toBe('02/03/2026, 09:00');
    expect(local(doses[1]!)).toBe('02/03/2026, 21:00');
    expect(local(doses[15]!)).toBe('09/03/2026, 21:00');
  });

  it('steps every other day when asked to', () => {
    const doses = expand(parseRule('FREQ=DAILY;INTERVAL=2;COUNT=3'), {
      start,
      startHour: 8,
      startMinute: 30,
      timezone: istanbul,
    });

    expect(doses.map((d) => local(d))).toEqual([
      '02/03/2026, 08:30',
      '04/03/2026, 08:30',
      '06/03/2026, 08:30',
    ]);
  });

  it('lands on the named weekdays', () => {
    // 2 March 2026 is a Monday.
    const doses = expand(parseRule('FREQ=WEEKLY;BYDAY=MO,TH;COUNT=4'), {
      start,
      startHour: 10,
      startMinute: 0,
      timezone: istanbul,
    });

    expect(doses.map((d) => local(d))).toEqual([
      '02/03/2026, 10:00',
      '05/03/2026, 10:00',
      '09/03/2026, 10:00',
      '12/03/2026, 10:00',
    ]);
  });

  it('steps in real time when the rule is hourly', () => {
    const doses = expand(parseRule('FREQ=HOURLY;INTERVAL=8;COUNT=4'), {
      start,
      startHour: 8,
      startMinute: 0,
      timezone: istanbul,
    });

    expect(doses.map((d) => local(d))).toEqual([
      '02/03/2026, 08:00',
      '02/03/2026, 16:00',
      '03/03/2026, 00:00',
      '03/03/2026, 08:00',
    ]);
  });

  /**
   * The bug this is here to prevent: a course written in winter and taken
   * across a clock change. Computing in UTC and adding twenty-four hours moves
   * every dose after the change by an hour — for a twice-daily antibiotic that
   * is eight hours apart becoming seven.
   */
  it('keeps the wall-clock hour across a daylight-saving change', () => {
    const doses = expand(parseRule('FREQ=DAILY;COUNT=4;BYHOUR=9'), {
      // Germany moves its clocks on 29 March 2026.
      start: { year: 2026, month: 3, day: 27 },
      startHour: 9,
      startMinute: 0,
      timezone: berlin,
    });

    expect(doses.map((d) => local(d, berlin))).toEqual([
      '27/03/2026, 09:00',
      '28/03/2026, 09:00',
      '29/03/2026, 09:00',
      '30/03/2026, 09:00',
    ]);

    // And the instants really are different lengths apart, which is the point.
    const beforeChange = doses[1]!.getTime() - doses[0]!.getTime();
    const acrossChange = doses[2]!.getTime() - doses[1]!.getTime();
    expect(beforeChange).toBe(24 * 60 * 60 * 1000);
    expect(acrossChange).toBe(23 * 60 * 60 * 1000);
  });

  /**
   * The gap a mutation test found: the wall-clock conversion was covered, and
   * stepping from one day to the next was not. A naive `day + 1` produces
   * "32 March", which `Intl` then renders as some other date entirely.
   */
  it('steps correctly across a month boundary', () => {
    const doses = expand(parseRule('FREQ=DAILY;COUNT=4;BYHOUR=9'), {
      start: { year: 2026, month: 3, day: 30 },
      startHour: 9,
      startMinute: 0,
      timezone: istanbul,
    });

    expect(doses.map((d) => local(d))).toEqual([
      '30/03/2026, 09:00',
      '31/03/2026, 09:00',
      '01/04/2026, 09:00',
      '02/04/2026, 09:00',
    ]);
  });

  it('steps correctly across a leap February', () => {
    const doses = expand(parseRule('FREQ=DAILY;COUNT=3;BYHOUR=9'), {
      start: { year: 2028, month: 2, day: 28 },
      startHour: 9,
      startMinute: 0,
      timezone: istanbul,
    });

    expect(doses.map((d) => local(d))).toEqual([
      '28/02/2028, 09:00',
      '29/02/2028, 09:00',
      '01/03/2028, 09:00',
    ]);
  });

  it('stops at UNTIL', () => {
    const doses = expand(parseRule('FREQ=DAILY;UNTIL=20260304T235959Z'), {
      start,
      startHour: 9,
      startMinute: 0,
      timezone: istanbul,
    });

    expect(doses).toHaveLength(3);
  });

  it('stops at the medication end date, whatever the rule says', () => {
    const doses = expand(parseRule('FREQ=DAILY'), {
      start,
      startHour: 9,
      startMinute: 0,
      timezone: istanbul,
      endsAt: at('2026-03-05T00:00:00.000Z'),
    });

    expect(doses.length).toBeLessThanOrEqual(3);
  });

  /** A rule bounded by nothing is not a prescription, it is a loop. */
  it('never generates more than the ceiling', () => {
    const doses = expand(parseRule('FREQ=DAILY;BYHOUR=6,12,18'), {
      start,
      startHour: 6,
      startMinute: 0,
      timezone: istanbul,
    });

    expect(doses.length).toBeLessThanOrEqual(MAX_OCCURRENCES);
  });

  it('does not put a dose before the course began', () => {
    const doses = expand(parseRule('FREQ=DAILY;COUNT=3;BYHOUR=8,20'), {
      start,
      // Written at midday, so the eight o'clock slot on day one is past.
      startHour: 12,
      startMinute: 0,
      timezone: istanbul,
    });

    expect(local(doses[0]!)).toBe('02/03/2026, 20:00');
  });
});

/**
 * Adherence, and the false alarms it must not raise.
 */
describe('scoring adherence', () => {
  const now = at('2026-03-10T12:00:00.000Z');

  it('scores over the doses that have come due', () => {
    const summary = summarise(
      [
        dose('2026-03-09T09:00:00.000Z', MedicationLogStatus.TAKEN),
        dose('2026-03-09T21:00:00.000Z', MedicationLogStatus.SKIPPED),
        dose('2026-03-10T09:00:00.000Z', MedicationLogStatus.TAKEN),
        dose('2026-03-11T09:00:00.000Z'),
      ],
      now,
    );

    // Two of three that came due; the fourth is tomorrow.
    expect(summary.taken).toBe(2);
    expect(summary.missed).toBe(1);
    expect(summary.upcoming).toBe(1);
    expect(summary.score).toBeCloseTo(2 / 3, 5);
  });

  /**
   * A plan written this morning must not read as nought per cent this
   * afternoon — that is the number the low-adherence warning fires on.
   */
  it('has no score at all before anything has come due', () => {
    const summary = summarise([dose('2026-03-11T09:00:00.000Z')], now);

    expect(summary.score).toBeNull();
    expect(needsAttention(summary)).toBe(false);
  });

  it('gives a dose its grace period before counting it against anyone', () => {
    const justNow = summarise([dose('2026-03-10T10:00:00.000Z')], now);
    const longAgo = summarise(
      [dose(`2026-03-10T0${12 - GRACE_HOURS - 1}:00:00.000Z`)],
      now,
    );

    expect(justNow.score).toBeNull();
    expect(longAgo.score).toBe(0);
  });

  /** A patient who took the eight o'clock dose at eleven took it. */
  it('counts a late dose as taken', () => {
    const summary = summarise([dose('2026-03-09T09:00:00.000Z', MedicationLogStatus.LATE)], now);

    expect(summary.score).toBe(1);
  });

  /** "Later" has not arrived until the grace period has. */
  it('treats a snoozed dose as still waiting', () => {
    const summary = summarise([dose('2026-03-10T11:00:00.000Z', MedicationLogStatus.SNOOZED)], now);

    expect(summary.score).toBeNull();
    expect(summary.upcoming).toBe(1);
  });
});

describe('the streak', () => {
  const now = at('2026-03-10T22:00:00.000Z');

  it('counts consecutive days where every due dose was taken', () => {
    const logs = [
      dose('2026-03-08T09:00:00.000Z', MedicationLogStatus.TAKEN),
      dose('2026-03-09T09:00:00.000Z', MedicationLogStatus.TAKEN),
      dose('2026-03-10T09:00:00.000Z', MedicationLogStatus.TAKEN),
    ];

    expect(streakOf(logs, now)).toBe(3);
  });

  it('breaks on a day with a missed dose', () => {
    const logs = [
      dose('2026-03-08T09:00:00.000Z', MedicationLogStatus.TAKEN),
      dose('2026-03-09T09:00:00.000Z', MedicationLogStatus.SKIPPED),
      dose('2026-03-10T09:00:00.000Z', MedicationLogStatus.TAKEN),
    ];

    expect(streakOf(logs, now)).toBe(1);
  });

  /**
   * A streak that reset at midnight and rebuilt through the morning would show
   * a patient losing a fortnight's run at breakfast.
   */
  it('does not break on a day whose doses are still ahead', () => {
    const logs = [
      dose('2026-03-09T09:00:00.000Z', MedicationLogStatus.TAKEN),
      dose('2026-03-10T09:00:00.000Z', MedicationLogStatus.TAKEN),
      dose('2026-03-11T09:00:00.000Z'),
    ];

    expect(streakOf(logs, at('2026-03-10T23:00:00.000Z'))).toBe(2);
  });

  it('is nothing when there is nothing to count', () => {
    expect(streakOf([], now)).toBe(0);
  });
});

/**
 * M9 asks for gamification "without overdoing it and without undercutting the
 * medical seriousness". A course of antibiotics is not a game with a high
 * score, and a patient who misses doses because they feel unwell is not losing.
 */
describe('the badges', () => {
  const now = at('2026-03-10T22:00:00.000Z');

  it('gives one for the first dose taken', () => {
    const summary = summarise([dose('2026-03-10T09:00:00.000Z', MedicationLogStatus.TAKEN)], now);

    expect(badgesFor(summary)).toContain('first-dose');
  });

  it('adds them as the streak grows', () => {
    const week = Array.from({ length: 7 }, (_, index) =>
      dose(
        `2026-03-${String(index + 4).padStart(2, '0')}T09:00:00.000Z`,
        MedicationLogStatus.TAKEN,
      ),
    );

    expect(badgesFor(summarise(week, now))).toEqual(['first-dose', 'three-days', 'one-week']);
  });

  /** Nothing here can be lost, and nothing mentions a missed dose. */
  it('has no badge that names a failure', () => {
    for (const badge of BADGES) {
      expect(badge.id).not.toMatch(/miss|fail|lost|broken|streak-lost/);
    }
  });

  it('gives none when nothing has been taken', () => {
    expect(badgesFor(summarise([dose('2026-03-01T09:00:00.000Z', MedicationLogStatus.SKIPPED)], now))).toEqual(
      [],
    );
  });
});

describe('telling the clinic', () => {
  const now = at('2026-03-10T22:00:00.000Z');

  const missedOutOf = (missed: number, total: number): DoseLog[] =>
    Array.from({ length: total }, (_, index) =>
      dose(
        `2026-03-${String((index % 8) + 1).padStart(2, '0')}T${String(index % 6).padStart(2, '0')}:00:00.000Z`,
        index < missed ? MedicationLogStatus.SKIPPED : MedicationLogStatus.TAKEN,
      ),
    );

  it('warns below seventy per cent once there is a pattern', () => {
    const summary = summarise(missedOutOf(4, 10), now);

    expect(summary.score).toBeLessThan(LOW_ADHERENCE);
    expect(needsAttention(summary)).toBe(true);
  });

  it('stays quiet above the threshold', () => {
    expect(needsAttention(summarise(missedOutOf(2, 10), now))).toBe(false);
  });

  /**
   * One missed dose out of two is thirty-three per cent and means nothing. The
   * same rate over a fortnight is what the warning is for.
   */
  it('does not warn on a handful of doses', () => {
    const summary = summarise(missedOutOf(2, 3), now);

    expect(summary.score).toBeLessThan(LOW_ADHERENCE);
    expect(summary.due).toBeLessThan(MIN_DOSES_BEFORE_WARNING);
    expect(needsAttention(summary)).toBe(false);
  });
});

/**
 * Counted in doses left rather than days: "two days" of a three-times-daily
 * course and of a once-weekly one are not the same amount of medicine, and it
 * is the medicine that runs out.
 */
describe('the renewal reminder', () => {
  const now = at('2026-03-10T12:00:00.000Z');

  it('fires when the last dose is within two days', () => {
    expect(needsRenewal([dose('2026-03-11T09:00:00.000Z')], now)).toBe(true);
  });

  it('stays quiet while there is more than two days left', () => {
    expect(needsRenewal([dose('2026-03-20T09:00:00.000Z')], now)).toBe(false);
  });

  it('does not fire on a course that has already finished', () => {
    expect(needsRenewal([dose('2026-03-01T09:00:00.000Z', MedicationLogStatus.TAKEN)], now)).toBe(
      false,
    );
  });
});
