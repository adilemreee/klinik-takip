import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { Env } from '../config/env.schema';
import { EncryptionService } from '../crypto/encryption.service';

export interface TotpSetup {
  /** Shown once, so the user can type it in if scanning fails. */
  secret: string;
  /** otpauth:// URI the client renders as a QR code. */
  uri: string;
}

export interface TotpVerification {
  valid: boolean;
  /** Time step the code matched, persisted to block replay of the same code. */
  timeStep?: number;
}

/**
 * TOTP second factor. Mandatory for staff, optional for patients
 * (spec section 2).
 *
 * Two things here are deliberate:
 *
 *  - Secrets are encrypted before they reach the database. A TOTP secret in a
 *    dump is a permanent second-factor bypass for that account.
 *  - Each accepted code's time step is recorded and later codes must come from
 *    a strictly later step. Without it, a code observed over someone's shoulder
 *    or captured by a phishing proxy stays usable for the rest of its window.
 */
@Injectable()
export class TotpService {
  /**
   * One step of tolerance either side. Zero rejects users whose phone clock is
   * a few seconds off; wider meaningfully extends the guessing interval for a
   * six-digit code.
   */
  private static readonly EPOCH_TOLERANCE = 1;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly encryption: EncryptionService,
  ) {}

  generate(accountLabel: string): TotpSetup {
    const secret = generateSecret();
    const issuer = this.config.get('TOTP_ISSUER', { infer: true });

    return { secret, uri: generateURI({ issuer, label: accountLabel, secret }) };
  }

  verify(code: string, secret: string, afterTimeStep?: number): TotpVerification {
    try {
      const result = verifySync({
        token: code,
        secret,
        epochTolerance: TotpService.EPOCH_TOLERANCE,
        ...(afterTimeStep === undefined ? {} : { afterTimeStep }),
      });

      if (!result.valid) {
        return { valid: false };
      }

      // verifySync's return type unions the TOTP and HOTP results; only the
      // TOTP branch carries timeStep, and only that branch can occur here.
      return { valid: true, timeStep: 'timeStep' in result ? result.timeStep : undefined };
    } catch {
      // A malformed secret or code is a failed check, never a 500 on login.
      return { valid: false };
    }
  }

  /** Verifies against the encrypted secret as stored on the user row. */
  verifyEncrypted(code: string, encryptedSecret: string, afterTimeStep?: number): TotpVerification {
    try {
      return this.verify(code, this.encryption.decrypt(encryptedSecret), afterTimeStep);
    } catch {
      return { valid: false };
    }
  }

  encryptSecret(secret: string): string {
    return this.encryption.encrypt(secret);
  }
}
