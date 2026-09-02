import { AppointmentStatus, AppointmentType } from '@prisma/client';
import { buildCalendar, escapeText, foldLine, icsTimestamp } from './ics';

type Bookable = Parameters<typeof buildCalendar>[0][number]['appointment'];

const appointment = (over: Partial<Bookable> = {}): Bookable => ({
  id: '01a04000-0000-7000-8000-000000000001',
  scheduledAt: new Date('2026-03-10T09:00:00.000Z'),
  durationMinutes: 30,
  type: AppointmentType.CONTROL,
  location: null,
  note: null,
  status: AppointmentStatus.CONFIRMED,
  ...over,
});

/**
 * The calendar file.
 *
 * Written by hand because the format is a dozen lines and the failures that
 * matter — escaping and folding — are ones a library hides rather than removes.
 * A file a calendar app refuses is one the patient never sees the appointment
 * in.
 */
describe('exporting appointments as iCalendar', () => {
  describe('the pieces', () => {
    it('writes a timestamp the way RFC 5545 wants it', () => {
      expect(icsTimestamp(new Date('2026-03-10T09:05:07.123Z'))).toBe('20260310T090507Z');
    });

    /**
     * A comma in a location — "Kat 3, Oda 12" — ends the property early if it
     * is not escaped, and the calendar app drops the rest or refuses the file.
     */
    it.each([
      [';', '\\;'],
      [',', '\\,'],
      ['\\', '\\\\'],
    ])('escapes %s', (input, expected) => {
      expect(escapeText(`a${input}b`)).toBe(`a${expected}b`);
    });

    it('escapes a newline rather than breaking the property', () => {
      expect(escapeText('first\nsecond')).toBe('first\\nsecond');
    });

    it('leaves a short line alone', () => {
      expect(foldLine('SUMMARY:Kontrol')).toBe('SUMMARY:Kontrol');
    });

    it('folds a long line with a leading space', () => {
      const folded = foldLine(`SUMMARY:${'a'.repeat(200)}`);
      const parts = folded.split('\r\n');

      expect(parts.length).toBeGreaterThan(1);
      expect(parts.slice(1).every((part) => part.startsWith(' '))).toBe(true);
      expect(Buffer.from(parts[0]!, 'utf8').length).toBeLessThanOrEqual(75);
    });

    /**
     * Counted in bytes, not characters: a Turkish "ş" is two bytes, and folding
     * by character length produces lines that look legal here and are too long
     * for a strict parser.
     */
    it('folds by bytes and never splits a character', () => {
      const folded = foldLine(`SUMMARY:${'ş'.repeat(100)}`);

      for (const part of folded.split('\r\n')) {
        expect(Buffer.from(part, 'utf8').length).toBeLessThanOrEqual(75);
      }

      // Nothing was corrupted in the process.
      expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'ş'.repeat(100)}`);
    });
  });

  describe('the calendar', () => {
    const now = new Date('2026-03-01T00:00:00.000Z');

    it('wraps events in a valid calendar', () => {
      const ics = buildCalendar([{ appointment: appointment(), summary: 'Kontrol' }], now);

      expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
      expect(ics).toContain('VERSION:2.0');
    });

    it('writes the start and the end', () => {
      const ics = buildCalendar([{ appointment: appointment(), summary: 'Kontrol' }], now);

      expect(ics).toContain('DTSTART:20260310T090000Z');
      expect(ics).toContain('DTEND:20260310T093000Z');
    });

    /** Re-importing updates the event rather than adding a second copy. */
    it('uses the appointment id as the event id', () => {
      const ics = buildCalendar([{ appointment: appointment(), summary: 'Kontrol' }], now);

      expect(ics).toContain('UID:01a04000-0000-7000-8000-000000000001@klinik-takip');
    });

    it('includes the location and note when there are any', () => {
      const ics = buildCalendar(
        [
          {
            appointment: appointment({ location: 'Kat 3, Oda 12', note: 'Aç karnına gelin' }),
            summary: 'Kontrol',
          },
        ],
        now,
      );

      expect(ics).toContain('LOCATION:Kat 3\\, Oda 12');
      expect(ics).toContain('DESCRIPTION:Aç karnına gelin');
    });

    it('omits a location that is not set', () => {
      const ics = buildCalendar([{ appointment: appointment(), summary: 'Kontrol' }], now);

      expect(ics).not.toContain('LOCATION:');
    });

    /**
     * Exported as cancelled rather than left out, so importing again removes it
     * from the patient's calendar instead of leaving them with an appointment
     * the clinic called off.
     */
    it('marks a cancelled appointment cancelled', () => {
      const ics = buildCalendar(
        [
          {
            appointment: appointment({ status: AppointmentStatus.CANCELLED }),
            summary: 'Kontrol',
          },
        ],
        now,
      );

      expect(ics).toContain('STATUS:CANCELLED');
    });

    it('writes one event per appointment', () => {
      const ics = buildCalendar(
        [
          { appointment: appointment(), summary: 'Kontrol' },
          {
            appointment: appointment({ id: '01a04000-0000-7000-8000-000000000002' }),
            summary: 'Muayene',
          },
        ],
        now,
      );

      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    });

    it('produces an empty but valid calendar for nobody with appointments', () => {
      const ics = buildCalendar([], now);

      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).not.toContain('BEGIN:VEVENT');
    });

    /** Every line ends CRLF; a bare newline is not iCalendar. */
    it('separates every line with CRLF', () => {
      const ics = buildCalendar([{ appointment: appointment(), summary: 'Kontrol' }], now);

      expect(ics.split('\r\n').length).toBeGreaterThan(5);
      expect(/[^\r]\n/.test(ics)).toBe(false);
    });
  });
});
