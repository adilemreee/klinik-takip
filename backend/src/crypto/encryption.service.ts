import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VERSION = 'v1';

/**
 * Column-level encryption for the few fields that must not be readable even to
 * someone holding a database dump (spec section 8): TOTP secrets today,
 * national identifiers and similar later.
 *
 * AES-256-GCM, so ciphertext is authenticated — a tampered value fails to
 * decrypt instead of silently yielding garbage.
 *
 * Values carry a version prefix so a future key rotation can decrypt old
 * ciphertext while writing new.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const raw = config.get('ENCRYPTION_KEY', { infer: true });
    this.key = Buffer.from(raw, 'base64');

    if (this.key.length !== 32) {
      // Fail at construction, not on the first patient record.
      throw new InternalServerErrorException(
        'ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256',
      );
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${VERSION}:${Buffer.concat([iv, authTag, ciphertext]).toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [version, encoded] = payload.split(':', 2);

    if (version !== VERSION || !encoded) {
      throw new InternalServerErrorException('Unrecognised ciphertext format');
    }

    const raw = Buffer.from(encoded, 'base64');
    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /**
   * Constant-time comparison. Used wherever a secret is compared against user
   * input, so the number of matching leading bytes cannot be timed.
   */
  static safeEquals(a: string, b: string): boolean {
    const bufferA = Buffer.from(a, 'utf8');
    const bufferB = Buffer.from(b, 'utf8');

    if (bufferA.length !== bufferB.length) {
      return false;
    }

    return timingSafeEqual(bufferA, bufferB);
  }
}
