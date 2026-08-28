import { randomBytes } from 'node:crypto';

/**
 * Characters that cannot be confused when read aloud over the phone or copied
 * from a printed report. Patients and staff exchange this number verbally in a
 * health tourism setting, often across a language barrier.
 *
 * Excludes 0/O and 1/I/L, which are the pairs that actually get misread, and U,
 * which keeps a random six-character string from spelling something unfortunate
 * on a clinical document. 30 characters still gives 729 million combinations.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * File numbers are random, not sequential.
 *
 * A sequential MRN tells anyone who holds one roughly how many patients the
 * clinic has and lets them walk the range. The year prefix keeps them sortable
 * and recognisable for staff without carrying a count.
 */
export function generateMrn(now: Date = new Date()): string {
  const bytes = randomBytes(6);
  let suffix = '';

  for (let i = 0; i < 6; i += 1) {
    suffix += ALPHABET[bytes[i]! % ALPHABET.length];
  }

  return `${now.getUTCFullYear()}-${suffix}`;
}

export function isValidMrn(value: string): boolean {
  return /^\d{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/.test(value);
}
