import type { Appointment } from '@prisma/client';

/**
 * An iCalendar file for a patient's appointments (spec M10).
 *
 * Written by hand rather than with a library: the format is a dozen lines, and
 * the failures that matter are escaping and line folding, which a library would
 * hide rather than remove. Both are tested.
 */

/** RFC 5545 wants UTC as YYYYMMDDTHHMMSSZ, with no separators. */
export function icsTimestamp(at: Date): string {
  return `${at.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/**
 * Escapes a value.
 *
 * A comma or a semicolon in a location — "Kat 3, Oda 12" — ends the property
 * early if it is not escaped, and the calendar app either drops the rest or
 * refuses the file.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Folds a line to 75 octets, continuing with a leading space.
 *
 * Counted in bytes rather than characters: a Turkish "ş" is two bytes, and
 * folding by character length produces lines that are legal to us and too long
 * for a strict parser.
 */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let start = 0;

  while (start < bytes.length) {
    // The first line takes 75 octets, continuations 74 plus their leading space.
    const limit = parts.length === 0 ? 75 : 74;
    let end = Math.min(start + limit, bytes.length);

    // Never split a multi-byte character: continuation bytes are 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) {
      end -= 1;
    }

    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }

  return parts.join('\r\n ');
}

export interface CalendarEntry {
  appointment: Pick<
    Appointment,
    'id' | 'scheduledAt' | 'durationMinutes' | 'type' | 'location' | 'note' | 'status'
  >;
  summary: string;
}

export function buildCalendar(entries: CalendarEntry[], now = new Date()): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Klinik Takip//Appointments//TR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const entry of entries) {
    const { appointment } = entry;
    const end = new Date(
      appointment.scheduledAt.getTime() + appointment.durationMinutes * 60_000,
    );

    lines.push(
      'BEGIN:VEVENT',
      // The appointment's own id, so re-importing the file updates the event
      // rather than adding a second copy of it.
      `UID:${appointment.id}@klinik-takip`,
      `DTSTAMP:${icsTimestamp(now)}`,
      `DTSTART:${icsTimestamp(appointment.scheduledAt)}`,
      `DTEND:${icsTimestamp(end)}`,
      `SUMMARY:${escapeText(entry.summary)}`,
    );

    if (appointment.location) {
      lines.push(`LOCATION:${escapeText(appointment.location)}`);
    }

    if (appointment.note) {
      lines.push(`DESCRIPTION:${escapeText(appointment.note)}`);
    }

    // A cancelled appointment is exported as cancelled rather than omitted, so
    // importing again removes it from the patient's calendar instead of leaving
    // them with an event the clinic has called off.
    lines.push(`STATUS:${appointment.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED'}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
