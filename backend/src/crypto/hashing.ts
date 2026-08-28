import { createHash, randomBytes } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/**
 * Argon2id with parameters above the OWASP 2024 minimum (19 MiB, t=2, p=1).
 * Memory cost is what makes GPU cracking expensive, so it carries the weight.
 */
const ARGON_OPTIONS = {
  memoryCost: 47_104, // 46 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

export function hashPassword(plaintext: string): Promise<string> {
  return argonHash(plaintext, ARGON_OPTIONS);
}

export async function verifyPassword(digest: string, plaintext: string): Promise<boolean> {
  try {
    return await argonVerify(digest, plaintext);
  } catch {
    // A malformed digest is a failed verification, never a crash on the login path.
    return false;
  }
}

/**
 * Refresh tokens and invitation codes are compared, not authenticated against a
 * user-chosen password, and they already carry full entropy from the CSPRNG.
 * SHA-256 is the right tool: a slow KDF here would only add latency to every
 * token refresh without adding security, because there is no low-entropy
 * secret to protect against brute force.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 256 bits of CSPRNG output, URL-safe. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Numeric code for SMS and e-mail invitations. Short enough to type, and
 * protected by attempt limits and expiry rather than by length alone.
 */
export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  // Rejection sampling keeps the distribution uniform; a plain modulo would
  // make the low digits marginally more likely.
  const limit = Math.floor(0xff_ff_ff_ff / max) * max;

  let value: number;
  do {
    value = randomBytes(4).readUInt32BE(0);
  } while (value >= limit);

  return String(value % max).padStart(digits, '0');
}
