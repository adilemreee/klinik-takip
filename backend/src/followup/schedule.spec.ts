import { addDays, addMonths, instantAt, localDate } from '../common/local-calendar';
import { planMilestones } from './schedule';

const istanbul = 'Europe/Istanbul';

/**
 * Follow-up dates.
 *
 * This is the part that can be wrong for six months before anyone notices: a
 * check-up date one day out looks entirely plausible on a screen, and the only
 * symptom is a patient called on the wrong day.
 */
describe('planning follow-up milestones', () => {
  describe('calendar arithmetic', () => {
    it('adds days across a month boundary', () => {
      expect(addDays({ year: 2026, month: 1, day: 30 }, 7)).toEqual({
        year: 2026,
        month: 2,
        day: 6,
      });
    });

    /**
     * An operation on 31 January has its one-month check on 28 February, not
     * 3 March — which is where adding a month lands when nobody thinks about
     * it. By six months that drift is days.
     */
    it('clamps a month addition to the end of a shorter month', () => {
      expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
        year: 2026,
        month: 2,
        day: 28,
      });
    });

    it('handles a leap February', () => {
      expect(addMonths({ year: 2028, month: 1, day: 31 }, 1)).toEqual({
        year: 2028,
        month: 2,
        day: 29,
      });
    });

    it('crosses a year', () => {
      expect(addMonths({ year: 2026, month: 11, day: 15 }, 3)).toEqual({
        year: 2027,
        month: 2,
        day: 15,
      });
    });

    it('adds a whole year', () => {
      expect(addMonths({ year: 2026, month: 3, day: 2 }, 12)).toEqual({
        year: 2027,
        month: 3,
        day: 2,
      });
    });
  });

  describe('the hour a reminder lands', () => {
    it('is ten in the morning, clinic time', () => {
      const at = instantAt({ year: 2026, month: 3, day: 2 }, 10, istanbul);

      expect(localDate(at, istanbul)).toEqual({ year: 2026, month: 3, day: 2 });
      expect(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: istanbul,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(at),
      ).toBe('10:00');
    });

    /**
     * An operation at 23:30 must not give the patient a reminder at half past
     * eleven at night, every milestone, for a year.
     */
    it('ignores the hour the operation happened', () => {
      const lateNight = new Date('2026-03-01T20:30:00.000Z'); // 23:30 in Istanbul
      const [first] = planMilestones(lateNight, null, istanbul);

      expect(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: istanbul,
          hour: '2-digit',
          hour12: false,
        }).format(first!.dueAt),
      ).toBe('10');
    });

    /**
     * A schedule made in winter for a check-up in summer must not fire an hour
     * out — quietly, and only for half the year.
     */
    it('holds the local hour across a daylight-saving change', () => {
      const winter = instantAt({ year: 2026, month: 1, day: 15 }, 10, 'Europe/London');
      const summer = instantAt({ year: 2026, month: 7, day: 15 }, 10, 'Europe/London');

      const format = (at: Date): string =>
        new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/London',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(at);

      expect(format(winter)).toBe('10:00');
      expect(format(summer)).toBe('10:00');
      // The UTC instants differ by the offset, which is the whole point.
      expect(winter.getUTCHours()).not.toBe(summer.getUTCHours());
    });
  });

  describe('the default schedule', () => {
    const surgery = new Date('2026-03-02T09:00:00.000Z'); // noon in Istanbul

    it('produces the milestones the spec names', () => {
      const plan = planMilestones(surgery, null, istanbul);

      expect(plan.map((milestone) => milestone.label)).toEqual([
        'D1',
        'W1',
        'M1',
        'M2',
        'M3',
        'M6',
        'Y1',
      ]);
    });

    it('places them on the right local dates', () => {
      const plan = planMilestones(surgery, null, istanbul);
      const on = (label: string): ReturnType<typeof localDate> =>
        localDate(plan.find((milestone) => milestone.label === label)!.dueAt, istanbul);

      expect(on('D1')).toEqual({ year: 2026, month: 3, day: 3 });
      expect(on('W1')).toEqual({ year: 2026, month: 3, day: 9 });
      expect(on('M1')).toEqual({ year: 2026, month: 4, day: 2 });
      expect(on('M3')).toEqual({ year: 2026, month: 6, day: 2 });
      expect(on('Y1')).toEqual({ year: 2027, month: 3, day: 2 });
    });

    it('puts them in order', () => {
      const plan = planMilestones(surgery, null, istanbul);
      const times = plan.map((milestone) => milestone.dueAt.getTime());

      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });
  });

  describe('templates', () => {
    it('uses the schedule for the named procedure', () => {
      const plan = planMilestones(new Date('2026-03-02T09:00:00.000Z'), 'hairTransplant', istanbul);

      expect(plan.map((milestone) => milestone.label)).toContain('D3');
      expect(plan.map((milestone) => milestone.label)).toContain('W2');
    });

    /** A patient with no follow-up dates is one nobody calls. */
    it('falls back to the default set for a template nobody defined', () => {
      const plan = planMilestones(new Date('2026-03-02T09:00:00.000Z'), 'nonsense', istanbul);

      expect(plan.map((milestone) => milestone.label)).toEqual([
        'D1',
        'W1',
        'M1',
        'M2',
        'M3',
        'M6',
        'Y1',
      ]);
    });
  });

  describe('a date at the edge of a month', () => {
    /** The case the clamp exists for, seen end to end. */
    it('keeps every milestone inside the month it belongs to', () => {
      const surgery = new Date('2026-01-31T09:00:00.000Z');
      const plan = planMilestones(surgery, null, istanbul);
      const on = (label: string): ReturnType<typeof localDate> =>
        localDate(plan.find((milestone) => milestone.label === label)!.dueAt, istanbul);

      expect(on('M1')).toEqual({ year: 2026, month: 2, day: 28 });
      expect(on('M2')).toEqual({ year: 2026, month: 3, day: 31 });
      expect(on('M3')).toEqual({ year: 2026, month: 4, day: 30 });
    });
  });
});
