import { inQuietHours } from './quiet-hours';

const preference = (
  over: Partial<Parameters<typeof inQuietHours>[0]> = {},
): Parameters<typeof inQuietHours>[0] => ({
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  timezone: 'Europe/Istanbul',
  ...over,
});

/** 23:00 in Istanbul. */
const night = new Date('2026-03-02T20:00:00.000Z');
/** 12:00 in Istanbul. */
const midday = new Date('2026-03-02T09:00:00.000Z');
/** 03:00 in Istanbul. */
const smallHours = new Date('2026-03-02T00:00:00.000Z');

describe('quiet hours', () => {
  /** Overnight is the normal case, not the edge case. */
  it('covers the evening side of an overnight range', () => {
    expect(inQuietHours(preference(), night)).toBe(true);
  });

  it('covers the small hours of the next morning', () => {
    expect(inQuietHours(preference(), smallHours)).toBe(true);
  });

  it('is not quiet during the day', () => {
    expect(inQuietHours(preference(), midday)).toBe(false);
  });

  it('handles a range inside one day', () => {
    const nap = preference({ quietHoursStart: '13:00', quietHoursEnd: '15:00' });

    expect(inQuietHours(nap, new Date('2026-03-02T11:00:00.000Z'))).toBe(true);
    expect(inQuietHours(nap, midday)).toBe(false);
  });

  /** The end is exclusive: 08:00 on a 22:00–08:00 range is awake. */
  it('treats the end of the range as awake', () => {
    expect(inQuietHours(preference(), new Date('2026-03-02T05:00:00.000Z'))).toBe(false);
    expect(inQuietHours(preference(), new Date('2026-03-02T04:59:00.000Z'))).toBe(true);
  });

  /**
   * Half a range is an unfinished setting. Reading it as a whole one would
   * silence someone's notifications on the strength of a half-filled form.
   */
  it('is not quiet when only one end is set', () => {
    expect(inQuietHours(preference({ quietHoursEnd: null }), night)).toBe(false);
    expect(inQuietHours(preference({ quietHoursStart: null }), night)).toBe(false);
  });

  /**
   * The two mistakes are not equal: sending something that should have waited
   * is a disturbance, and withholding something that should have gone is a
   * patient who never hears about their result.
   */
  it('is not quiet when the range cannot be read', () => {
    expect(inQuietHours(preference({ quietHoursStart: 'evening' }), night)).toBe(false);
  });

  /** Quiet hours are the person's own local time, not the server's. */
  it('is read in the recipient timezone', () => {
    // 20:00 UTC is 23:00 in Istanbul and 20:00 in London.
    expect(inQuietHours(preference(), night)).toBe(true);
    expect(inQuietHours(preference({ timezone: 'Europe/London' }), night)).toBe(false);
  });
});
