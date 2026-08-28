/**
 * Password rules (spec section 2).
 *
 * Length is the requirement that actually matters, so the floor is 12 rather
 * than the more common 8. Composition rules are kept light on purpose: forcing
 * symbol classes pushes people towards predictable substitutions without
 * adding real entropy.
 */
const MIN_LENGTH = 12;
const MAX_LENGTH = 200;

/** Rejected outright regardless of length or composition. */
const COMMON_PASSWORDS = new Set([
  'password',
  'password123',
  'qwerty123456',
  '123456789012',
  'administrator',
  'klinikklinik',
  'sifre123456',
  'parola123456',
]);

export interface PasswordCheck {
  valid: boolean;
  reasons: string[];
}

export function checkPassword(password: string, personalData: string[] = []): PasswordCheck {
  const reasons: string[] = [];

  if (password.length < MIN_LENGTH) {
    reasons.push(`must be at least ${MIN_LENGTH} characters`);
  }

  if (password.length > MAX_LENGTH) {
    // An unbounded password is a denial-of-service vector against the KDF.
    reasons.push(`must be at most ${MAX_LENGTH} characters`);
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    reasons.push('is too common');
  }

  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    reasons.push('must contain both letters and numbers');
  }

  // A password containing the user's own e-mail or name is guessable by anyone
  // who knows them, which in a clinic is a large set of people.
  const lowered = password.toLowerCase();
  for (const value of personalData) {
    if (value.length >= 4 && lowered.includes(value.toLowerCase())) {
      reasons.push('must not contain your name or e-mail address');
      break;
    }
  }

  return { valid: reasons.length === 0, reasons };
}
