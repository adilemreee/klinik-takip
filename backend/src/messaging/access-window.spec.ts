import { localParts, parseTime, windowState, type WindowSpec } from './access-window';

const window = (over: Partial<WindowSpec> = {}): WindowSpec => ({
  dayOfWeek: 1,
  startTime: '18:00',
  endTime: '20:00',
  timezone: 'Europe/Istanbul',
  isActive: true,
  ...over,
});

/** A Monday, 19:00 in Istanbul (UTC+3). */
const mondayEvening = new Date('2026-03-02T16:00:00.000Z');
/** The same Monday, 09:00 in Istanbul. */
const mondayMorning = new Date('2026-03-02T06:00:00.000Z');

describe('when the clinic is reachable', () => {
  describe('reading a window', () => {
    it('reads a wall-clock time', () => {
      expect(parseTime('18:00')).toBe(18 * 60);
      expect(parseTime('9:05')).toBe(9 * 60 + 5);
      expect(parseTime('00:00')).toBe(0);
    });

    it('refuses something that is not a time', () => {
      expect(parseTime('evening')).toBeNull();
      expect(parseTime('25:00')).toBeNull();
      expect(parseTime('18:60')).toBeNull();
      expect(parseTime('')).toBeNull();
    });

    /**
     * Through Intl rather than by adding an offset: the offset is not a
     * constant, and a window that shifts by an hour twice a year is one nobody
     * trusts.
     */
    it('reads the clinic local day and time', () => {
      expect(localParts(mondayEvening, 'Europe/Istanbul')).toEqual({ day: 1, minutes: 19 * 60 });
      expect(localParts(mondayEvening, 'UTC')).toEqual({ day: 1, minutes: 16 * 60 });
    });
  });

  describe('inside and outside', () => {
    it('is open inside the window', () => {
      expect(windowState([window()], mondayEvening).open).toBe(true);
    });

    it('is closed outside it', () => {
      const state = windowState([window()], mondayMorning);

      expect(state.open).toBe(false);
      expect(state.opensAt).not.toBeNull();
    });

    it('is closed on a different day', () => {
      // Tuesday 19:00 Istanbul, against a Monday-only window.
      expect(windowState([window()], new Date('2026-03-03T16:00:00.000Z')).open).toBe(false);
    });

    /** The end is exclusive: 20:00 on an 18:00–20:00 window is closed. */
    it('treats the end of the window as closed', () => {
      expect(windowState([window()], new Date('2026-03-02T17:00:00.000Z')).open).toBe(false);
      expect(windowState([window()], new Date('2026-03-02T16:59:00.000Z')).open).toBe(true);
    });

    it('is open at the very start', () => {
      expect(windowState([window()], new Date('2026-03-02T15:00:00.000Z')).open).toBe(true);
    });

    it('ignores a window that has been switched off', () => {
      const windows = [window({ isActive: false }), window({ dayOfWeek: 3 })];

      // Monday evening: the only window that would cover it is switched off,
      // and the Wednesday one does not.
      expect(windowState(windows, mondayEvening).open).toBe(false);
    });

    /**
     * Switching every window off is not an instruction to close: it leaves no
     * schedule, which is the same state as never having set one. Reading it as
     * "closed forever" would swallow every message the moment a doctor
     * disabled their last window.
     */
    it('is open again when every window is switched off', () => {
      expect(windowState([window({ isActive: false })], mondayEvening).open).toBe(true);
    });

    /**
     * A clinic that has not configured hours has not asked for messages to be
     * held. Defaulting to closed would silently swallow every message the day
     * the feature shipped.
     */
    it('is always open when no window is configured', () => {
      const state = windowState([], mondayMorning);

      expect(state.open).toBe(true);
      expect(state.opensAt).toBeNull();
    });

    it('is open when any one window covers the moment', () => {
      const windows = [window({ dayOfWeek: 3 }), window({ dayOfWeek: 1 })];

      expect(windowState(windows, mondayEvening).open).toBe(true);
    });

    /**
     * A window we cannot read is skipped rather than treated as covering
     * everything or nothing: one bad row must not open or close the clinic on
     * its own.
     */
    it('skips a window whose times are unreadable', () => {
      const broken = window({ startTime: 'evening', endTime: 'night' });

      expect(windowState([broken], mondayEvening).open).toBe(false);
      expect(windowState([broken, window()], mondayEvening).open).toBe(true);
    });
  });

  describe('windows that cross midnight', () => {
    const overnight = window({ dayOfWeek: 1, startTime: '22:00', endTime: '02:00' });

    it('is open late on its own day', () => {
      // Monday 23:00 Istanbul.
      expect(windowState([overnight], new Date('2026-03-02T20:00:00.000Z')).open).toBe(true);
    });

    it('is open in the small hours of the next day', () => {
      // Tuesday 01:00 Istanbul.
      expect(windowState([overnight], new Date('2026-03-02T22:00:00.000Z')).open).toBe(true);
    });

    it('is closed after it ends', () => {
      // Tuesday 03:00 Istanbul.
      expect(windowState([overnight], new Date('2026-03-03T00:00:00.000Z')).open).toBe(false);
    });
  });

  describe('when it next opens', () => {
    /** What the patient is told, so "queued" is a wait and not a silence. */
    it('reports the next opening on the same day', () => {
      const state = windowState([window()], mondayMorning);

      expect(state.opensAt).not.toBeNull();
      expect(localParts(state.opensAt!, 'Europe/Istanbul')).toEqual({
        day: 1,
        minutes: 18 * 60,
      });
    });

    it('reports the next opening on a later day', () => {
      // Monday morning, with a Wednesday-only window.
      const state = windowState([window({ dayOfWeek: 3 })], mondayMorning);

      expect(localParts(state.opensAt!, 'Europe/Istanbul')).toEqual({
        day: 3,
        minutes: 18 * 60,
      });
    });

    it('reports nothing to wait for while open', () => {
      expect(windowState([window()], mondayEvening).opensAt).toBeNull();
    });

    /**
     * Seven days and no further. A schedule that opens nothing within a week is
     * effectively empty, and a date months away would show the patient a
     * promise the clinic never made.
     */
    it('reports nothing when no window will open within a week', () => {
      const unreadable = window({ startTime: 'x', endTime: 'y' });

      expect(windowState([unreadable], mondayMorning).opensAt).toBeNull();
    });

    it('picks the soonest of several windows', () => {
      const state = windowState(
        [window({ dayOfWeek: 5 }), window({ dayOfWeek: 2 })],
        mondayMorning,
      );

      expect(localParts(state.opensAt!, 'Europe/Istanbul').day).toBe(2);
    });
  });

  describe('timezones', () => {
    /**
     * The window is wall-clock time in the clinic's zone, so the same instant
     * is inside it for one clinic and outside it for another.
     */
    it('is read in the clinic zone, not the server one', () => {
      const istanbul = window({ timezone: 'Europe/Istanbul' });
      const london = window({ timezone: 'Europe/London' });

      // 16:00 UTC is 19:00 in Istanbul and 16:00 in London.
      expect(windowState([istanbul], mondayEvening).open).toBe(true);
      expect(windowState([london], mondayEvening).open).toBe(false);
    });
  });
});
