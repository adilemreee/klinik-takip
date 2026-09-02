import { dueReminders, overlaps, withinAvailability, type AvailabilitySpec } from './booking';

const at = (iso: string, durationMinutes = 30): { startsAt: Date; durationMinutes: number } => ({
  startsAt: new Date(iso),
  durationMinutes,
});

const window = (over: Partial<AvailabilitySpec> = {}): AvailabilitySpec => ({
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '18:00',
  timezone: 'Europe/Istanbul',
  isActive: true,
  ...over,
});

describe('booking an appointment', () => {
  describe('conflicts', () => {
    it('finds an overlap', () => {
      expect(overlaps(at('2026-03-02T09:00:00Z'), at('2026-03-02T09:15:00Z'))).toBe(true);
    });

    it('finds an appointment wholly inside another', () => {
      expect(overlaps(at('2026-03-02T09:00:00Z', 60), at('2026-03-02T09:15:00Z', 15))).toBe(true);
    });

    /**
     * Touching is not overlapping. A 10:00–10:30 and a 10:30–11:00 are the
     * normal way a clinic fills a morning, and refusing that would leave a gap
     * between every pair of appointments.
     */
    it('allows one appointment to start when another ends', () => {
      expect(overlaps(at('2026-03-02T09:00:00Z'), at('2026-03-02T09:30:00Z'))).toBe(false);
    });

    it('allows appointments on different days', () => {
      expect(overlaps(at('2026-03-02T09:00:00Z'), at('2026-03-03T09:00:00Z'))).toBe(false);
    });

    it('is symmetric', () => {
      const a = at('2026-03-02T09:00:00Z', 60);
      const b = at('2026-03-02T09:30:00Z');

      expect(overlaps(a, b)).toBe(overlaps(b, a));
    });
  });

  describe('availability', () => {
    // Monday, 12:00 in Istanbul.
    const monday = '2026-03-02T09:00:00Z';

    it('accepts a slot inside the window', () => {
      expect(withinAvailability(at(monday), [window()])).toBe(true);
    });

    it('refuses a slot on a day with no window', () => {
      expect(withinAvailability(at(monday), [window({ dayOfWeek: 3 })])).toBe(false);
    });

    /**
     * An appointment starting at 17:45 in a clinic that closes at 18:00 is a
     * half-hour appointment with fifteen minutes after closing, and booking it
     * puts somebody in an empty building.
     */
    it('refuses a slot that runs past the end of the window', () => {
      // 17:45 Istanbul, thirty minutes long.
      expect(withinAvailability(at('2026-03-02T14:45:00Z'), [window()])).toBe(false);
    });

    it('accepts a slot that ends exactly at closing time', () => {
      // 17:30 Istanbul, thirty minutes long.
      expect(withinAvailability(at('2026-03-02T14:30:00Z'), [window()])).toBe(true);
    });

    it('refuses a slot starting before the window opens', () => {
      // 08:30 Istanbul.
      expect(withinAvailability(at('2026-03-02T05:30:00Z'), [window()])).toBe(false);
    });

    /**
     * The opposite default from the messaging window, and for the opposite
     * reason: a doctor who has published no hours has not offered any, and
     * inventing some would book patients into time nobody agreed to.
     */
    it('refuses everything when no window is published', () => {
      expect(withinAvailability(at(monday), [])).toBe(false);
      expect(withinAvailability(at(monday), [window({ isActive: false })])).toBe(false);
    });

    it('accepts when any one window covers the slot', () => {
      expect(withinAvailability(at(monday), [window({ dayOfWeek: 4 }), window()])).toBe(true);
    });

    it('skips a window whose times cannot be read', () => {
      expect(withinAvailability(at(monday), [window({ startTime: 'morning' })])).toBe(false);
    });

    /** Availability is the clinic's wall clock, not the server's. */
    it('is read in the clinic timezone', () => {
      // 12:00 Istanbul is 09:00 in London — both inside 09:00–18:00.
      expect(withinAvailability(at(monday), [window({ timezone: 'Europe/London' })])).toBe(true);
      // 09:30 Istanbul is 06:30 in London, which is not.
      expect(
        withinAvailability(at('2026-03-02T06:30:00Z'), [window({ timezone: 'Europe/London' })]),
      ).toBe(false);
    });
  });

  describe('reminders', () => {
    const appointment = new Date('2026-03-10T09:00:00Z');

    it('sends nothing long before the appointment', () => {
      expect(dueReminders(appointment, [], new Date('2026-02-20T09:00:00Z'))).toEqual([]);
    });

    it('sends the week-ahead reminder when its moment arrives', () => {
      expect(dueReminders(appointment, [], new Date('2026-03-03T09:00:00Z'))).toEqual(['P7D']);
    });

    it('sends the ones still outstanding as the appointment nears', () => {
      expect(dueReminders(appointment, ['P7D'], new Date('2026-03-09T09:00:00Z'))).toEqual(['P1D']);
      expect(dueReminders(appointment, ['P7D', 'P1D'], new Date('2026-03-10T07:30:00Z'))).toEqual([
        'PT2H',
      ]);
    });

    /** A worker that restarts must not send the same reminder twice. */
    it('does not repeat one already sent', () => {
      expect(dueReminders(appointment, ['P7D'], new Date('2026-03-03T10:00:00Z'))).toEqual([]);
    });

    /**
     * "In two hours" arriving after the appointment is worse than nothing: it
     * tells the patient something that is no longer true.
     */
    it('sends nothing once the appointment has passed', () => {
      expect(dueReminders(appointment, [], new Date('2026-03-10T10:00:00Z'))).toEqual([]);
    });

    /** Booked inside a day: the earlier reminders are already past. */
    it('sends only what is still ahead for a last-minute booking', () => {
      expect(dueReminders(appointment, [], new Date('2026-03-10T08:00:00Z'))).toEqual([
        'P7D',
        'P1D',
        'PT2H',
      ]);
    });
  });
});
