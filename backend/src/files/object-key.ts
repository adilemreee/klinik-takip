import { randomUUID } from 'node:crypto';

/**
 * Object keys carry no meaning.
 *
 * A key like `patients/<mrn>/passport.pdf` would leak the file number and the
 * document's nature to anyone who ever sees the key — a proxy log, a browser
 * history entry, a screenshot of a signed URL. The database maps key to patient;
 * the key itself says only when it was stored.
 *
 * The date prefix exists for operational reasons, not lookup: it makes bucket
 * listings and lifecycle rules manageable without revealing anything.
 */
export function buildObjectKey(extension?: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const suffix = extension ? `.${extension.replace(/^\./, '').toLowerCase()}` : '';

  return `${year}/${month}/${randomUUID()}${suffix}`;
}

/**
 * Rejects anything that could escape the bucket prefix or address a different
 * object. Keys always come from our own generator, so this is a guard against
 * a bug or a tampered value reaching MinIO, not against normal input.
 */
export function isSafeObjectKey(key: string): boolean {
  if (key.length === 0 || key.length > 512) {
    return false;
  }

  if (key.startsWith('/') || key.includes('..') || key.includes('//')) {
    return false;
  }

  return /^[A-Za-z0-9/_.-]+$/.test(key);
}
