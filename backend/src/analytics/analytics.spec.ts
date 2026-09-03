import {
  MAX_MONTHS,
  MIN_FOR_RATE,
  UNKNOWN_CHANNEL,
  availableMinutesIn,
  foldChannel,
  groupByFolded,
  monthKey,
  monthOf,
  monthsBetween,
  occupancyOf,
  rateOf,
  weekdayOccurrences,
  type Window,
} from './analytics';

/**
 * The arithmetic behind the dashboard (spec M11, T6.4).
 *
 * A dashboard's characteristic failure is a confident ratio over a denominator
 * nobody showed. These tests are mostly about refusing to produce one.
 */
describe('analytics', () => {
  describe('rates', () => {
    it('will not state a proportion from too few cases', () => {
      // One enquiry that became one operation is not a hundred per cent
      // conversion rate, and printing it as one invites a decision the number
      // cannot support.
      expect(rateOf(1, 1)).toBeNull();
      expect(rateOf(2, 3)).toBeNull();
      expect(rateOf(0, MIN_FOR_RATE - 1)).toBeNull();
    });

    it('states one once there are enough', () => {
      expect(rateOf(2, 5)).toBe(0.4);
      expect(rateOf(1, 3000)).toBe(0.0003);
    });

    it('is null rather than zero for an empty denominator', () => {
      // Null means "not enough to say"; zero would mean "none of them", and a
      // client that renders one as the other is stating something false.
      expect(rateOf(0, 0)).toBeNull();
    });

    it('never divides by a negative or produces one over one', () => {
      expect(rateOf(0, -3)).toBeNull();
      expect(rateOf(10, 10)).toBe(1);
    });
  });

  describe('months', () => {
    it('includes the empty ones', () => {
      // A chart that omits a quiet August draws a straight line through it.
      const months = monthsBetween(
        new Date('2026-01-15T00:00:00Z'),
        new Date('2026-04-02T00:00:00Z'),
        'Europe/Istanbul',
      );

      expect(months.map(monthKey)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    });

    it('crosses a year end', () => {
      const months = monthsBetween(
        new Date('2025-11-01T00:00:00Z'),
        new Date('2026-02-01T00:00:00Z'),
        'UTC',
      );

      expect(months.map(monthKey)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    });

    it('is empty for a reversed range rather than spinning', () => {
      const months = monthsBetween(
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-01-01T00:00:00Z'),
        'UTC',
      );

      expect(months).toEqual([]);
    });

    it('is bounded', () => {
      const months = monthsBetween(
        new Date('1990-01-01T00:00:00Z'),
        new Date('2090-01-01T00:00:00Z'),
        'UTC',
      );

      expect(months).toHaveLength(MAX_MONTHS);
    });

    it('reads the month in the clinic calendar, not UTC', () => {
      // 22:30 on 31 March in UTC is already April in Istanbul. An operation
      // that evening belongs to April's figures, which is the month the clinic
      // was living in when it happened.
      const lateEvening = new Date('2026-03-31T22:30:00.000Z');

      expect(monthKey(monthOf(lateEvening, 'Europe/Istanbul'))).toBe('2026-04');
      expect(monthKey(monthOf(lateEvening, 'UTC'))).toBe('2026-03');
    });
  });

  describe('grouping free text', () => {
    it('folds four spellings of one channel into one', () => {
      // Otherwise one channel's numbers are split four ways and every one of
      // them looks too small to keep.
      expect(foldChannel('Instagram')).toBe(foldChannel('INSTAGRAM '));
      expect(foldChannel('İnstagram')).toBe(foldChannel('instagram'));
    });

    it('leaves a different phrase as its own channel', () => {
      // Deciding that "Instagram reklam" belongs with "Instagram" would be this
      // module inventing the clinic's marketing categories.
      expect(foldChannel('Instagram reklam')).not.toBe(foldChannel('Instagram'));
    });

    it('keeps the spelling the clinic uses most as the label', () => {
      const groups = groupByFolded(
        [{ s: 'Instagram' }, { s: 'instagram' }, { s: 'Instagram' }],
        (item) => item.s,
      );

      expect(groups.get('instagram')?.label).toBe('Instagram');
      expect(groups.get('instagram')?.items).toHaveLength(3);
    });

    it('counts the ones with nothing recorded instead of dropping them', () => {
      // Dropping them would inflate every other channel's share.
      const groups = groupByFolded(
        [{ s: 'Google' }, { s: null }, { s: '  ' }],
        (item) => item.s,
      );

      expect(groups.get(UNKNOWN_CHANNEL)?.items).toHaveLength(2);
      expect(groups.get('google')?.items).toHaveLength(1);
    });
  });

  describe('capacity', () => {
    const nineToFive = (dayOfWeek: number): Window => ({
      dayOfWeek,
      startTime: '09:00',
      endTime: '17:00',
    });

    it('counts each weekday as often as it falls in the month', () => {
      // March 2026 begins on a Sunday and has 31 days, so five Mondays.
      expect(weekdayOccurrences({ year: 2026, month: 3 }, 1)).toBe(5);
      expect(weekdayOccurrences({ year: 2026, month: 3 }, 6)).toBe(4);
    });

    it('adds up a working week', () => {
      const windows = [1, 2, 3, 4, 5].map(nineToFive);
      const minutes = availableMinutesIn({ year: 2026, month: 3 }, windows);

      // 5 Mondays + 5 Tuesdays + 4×(Wed, Thu, Fri) = 22 days × 480 minutes.
      expect(minutes).toBe(22 * 480);
    });

    it('is unchanged by a daylight-saving month', () => {
      // A 09:00–17:00 window is eight hours of working day whichever side of a
      // clock change it falls on. Counting elapsed time would report the
      // clocks-go-back Sunday as a nine-hour day.
      const windows = [nineToFive(0)];

      expect(availableMinutesIn({ year: 2026, month: 3 }, windows)).toBe(5 * 480);
      expect(availableMinutesIn({ year: 2026, month: 10 }, windows)).toBe(4 * 480);
    });

    it('ignores a window that reads backwards rather than subtracting capacity', () => {
      const minutes = availableMinutesIn({ year: 2026, month: 3 }, [
        { dayOfWeek: 1, startTime: '17:00', endTime: '09:00' },
        { dayOfWeek: 1, startTime: 'not-a-time', endTime: '17:00' },
      ]);

      expect(minutes).toBe(0);
    });

    it('adds two windows on the same day', () => {
      const minutes = availableMinutesIn({ year: 2026, month: 3 }, [
        { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
        { dayOfWeek: 1, startTime: '13:00', endTime: '17:00' },
      ]);

      expect(minutes).toBe(5 * (180 + 240));
    });
  });

  describe('occupancy', () => {
    it('has no rate when no working hours are configured', () => {
      // Nought per cent would read as an empty diary; this is a missing
      // setting, which is a different thing to tell somebody.
      const occupancy = occupancyOf(600, 0);

      expect(occupancy.rate).toBeNull();
      expect(occupancy.bookedMinutes).toBe(600);
    });

    it('divides booked by available', () => {
      expect(occupancyOf(240, 480).rate).toBe(0.5);
    });

    it('reports overbooking rather than capping it at one', () => {
      // A diary fuller than the working week is a real and useful signal.
      expect(occupancyOf(960, 480).rate).toBe(2);
    });
  });
});
