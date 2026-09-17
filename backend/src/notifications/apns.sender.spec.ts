import { createPrivateKey, generateKeyPairSync, verify } from 'node:crypto';
import { mintProviderToken } from './apns.sender';

describe('the APNs provider token', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  const parts = (token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } => {
    const [header, payload] = token.split('.');

    return {
      header: JSON.parse(Buffer.from(header!, 'base64url').toString()) as Record<string, unknown>,
      payload: JSON.parse(Buffer.from(payload!, 'base64url').toString()) as Record<string, unknown>,
    };
  };

  it('names the key and the team where Apple looks for them', () => {
    const token = mintProviderToken(privateKey, 'ABC1234567', 'TEAM123456', 1_700_000_000_000);
    const { header, payload } = parts(token);

    expect(header).toEqual({ alg: 'ES256', kid: 'ABC1234567', typ: 'JWT' });
    expect(payload).toEqual({ iss: 'TEAM123456', iat: 1_700_000_000 });
  });

  /**
   * The one that is worth a test.
   *
   * Node signs ECDSA as a DER sequence unless told otherwise, and JWS wants
   * the raw r‖s pair. Apple answers a DER signature with
   * `InvalidProviderToken` — which reads as a wrong key, so the afternoon goes
   * on re-downloading the key rather than on the encoding.
   */
  it('signs in the encoding JWS wants, not the one Node defaults to', () => {
    const token = mintProviderToken(privateKey, 'ABC1234567', 'TEAM123456');
    const [header, payload, signature] = token.split('.');
    const raw = Buffer.from(signature!, 'base64url');

    // A P-256 r‖s pair is exactly 64 bytes; a DER sequence is 70-ish and
    // starts with 0x30.
    expect(raw).toHaveLength(64);
    expect(raw[0]).not.toBe(0x30);

    expect(
      verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, raw),
    ).toBe(true);
  });

  it('reads a key in the PEM Apple hands out', () => {
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

    expect(() => mintProviderToken(createPrivateKey(pem), 'K', 'T')).not.toThrow();
  });
});
