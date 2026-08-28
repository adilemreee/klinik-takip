import { ConfigService } from '@nestjs/config';
import { generateSync } from 'otplib';
import { EncryptionService } from '../crypto/encryption.service';
import { TotpService } from './totp.service';

describe('TotpService', () => {
  const configFor = (value: string): ConfigService =>
    ({ get: () => value }) as unknown as ConfigService;

  const encryption = new EncryptionService(
    configFor(Buffer.alloc(32, 7).toString('base64')) as never,
  );

  const service = new TotpService(configFor('Klinik Takip') as never, encryption);

  const currentCode = (secret: string): string => generateSync({ secret });

  it('generates a base32 secret and a scannable otpauth URI', () => {
    const setup = service.generate('doctor@clinic.example');

    expect(setup.secret).toMatch(/^[A-Z2-7]+$/);
    expect(setup.uri).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.uri).toContain('Klinik%20Takip');
  });

  it('accepts a current code', () => {
    const { secret } = service.generate('a@b.co');

    expect(service.verify(currentCode(secret), secret).valid).toBe(true);
  });

  it('rejects a wrong code', () => {
    const { secret } = service.generate('a@b.co');

    expect(service.verify('000000', secret).valid).toBe(false);
  });

  it('rejects a malformed secret without throwing', () => {
    expect(service.verify('123456', 'not-base32!!').valid).toBe(false);
  });

  /**
   * The reason totpLastStep exists: a code seen over someone's shoulder, or
   * captured by a phishing proxy, must not stay usable for the rest of its
   * 30-second window.
   */
  it('refuses to accept the same code twice', () => {
    const { secret } = service.generate('a@b.co');
    const code = currentCode(secret);

    const first = service.verify(code, secret);
    expect(first.valid).toBe(true);
    expect(first.timeStep).toEqual(expect.any(Number));

    const replay = service.verify(code, secret, first.timeStep);
    expect(replay.valid).toBe(false);
  });

  it('round-trips through encryption and verifies against the stored form', () => {
    const { secret } = service.generate('a@b.co');
    const stored = service.encryptSecret(secret);

    expect(stored).not.toContain(secret);
    expect(service.verifyEncrypted(currentCode(secret), stored).valid).toBe(true);
  });

  it('rejects a tampered stored secret rather than throwing', () => {
    const { secret } = service.generate('a@b.co');
    const stored = service.encryptSecret(secret);
    const tampered = `${stored.slice(0, -4)}AAAA`;

    expect(service.verifyEncrypted(currentCode(secret), tampered).valid).toBe(false);
  });
});
