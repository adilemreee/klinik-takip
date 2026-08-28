import { AuditAction, Prisma, Role } from '@prisma/client';
import { AuditService } from './audit.service';
import { PrismaService } from '../infra/prisma.service';

describe('AuditService redaction', () => {
  const created: { data: Record<string, unknown> }[] = [];
  const prisma = {
    auditLog: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        created.push(args);
        return Promise.resolve({});
      }),
    },
  } as unknown as PrismaService;

  const service = new AuditService(prisma);

  const write = async (payload: unknown): Promise<string> => {
    created.length = 0;
    await service.record({
      action: AuditAction.UPDATE,
      entityType: 'users',
      actorRole: Role.DOCTOR,
      after: payload,
    });
    return JSON.stringify(created[0]?.data.after);
  };

  /**
   * The audit log is retained for years and read by staff. A credential
   * captured in a snapshot would outlive every rotation of the thing it
   * protects.
   */
  it.each([
    ['passwordHash', '$argon2id$v=19$secret-digest'],
    ['totpSecret', 'JBSWY3DPEHPK3PXP'],
    ['refreshTokenHash', 'a'.repeat(64)],
    ['codeHash', 'b'.repeat(64)],
    ['token', 'live-token-value'],
    ['secret', 'shhh'],
  ])('redacts %s', async (field, value) => {
    const output = await write({ [field]: value });

    expect(output).not.toContain(value);
    expect(output).toContain('[redacted]');
  });

  it('redacts regardless of the casing used by the caller', async () => {
    const output = await write({ PasswordHash: 'digest-value', TOTPSECRET: 'secret-value' });

    expect(output).not.toContain('digest-value');
    expect(output).not.toContain('secret-value');
  });

  it('redacts inside nested objects and arrays', async () => {
    const output = await write({
      sessions: [{ deviceName: 'iPhone', refreshTokenHash: 'leaked-hash' }],
    });

    expect(output).not.toContain('leaked-hash');
    expect(output).toContain('iPhone');
  });

  it('keeps the fields an investigation actually needs', async () => {
    const output = await write({ status: 'ACTIVE', mrn: 'MRN-1', country: 'TR' });

    expect(output).toContain('ACTIVE');
    expect(output).toContain('MRN-1');
    expect(output).toContain('TR');
  });

  it('truncates rather than recursing without bound', async () => {
    // A cyclic structure must not stall the request that produced it.
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;

    const output = await write(cyclic);

    expect(output).toContain('[truncated]');
  });

  it('serialises dates rather than emitting an empty object', async () => {
    const output = await write({ signedAt: new Date('2026-01-02T03:04:05.000Z') });

    expect(output).toContain('2026-01-02T03:04:05.000Z');
  });

  /**
   * Weights, doses and money are Decimal columns. Prisma's JSON protocol
   * refuses to serialize a Decimal, which took down the whole transaction —
   * and with it the change being audited — rather than just the audit row.
   */
  it('serialises a decimal without losing digits', async () => {
    const output = await write({ weightKg: new Prisma.Decimal('72.375') });

    expect(output).toContain('72.375');
    expect(output).not.toContain('constructor');
  });

  it('records the size of a byte payload, never its contents', async () => {
    const output = await write({ ciphertext: Buffer.from('secret-bytes') });

    expect(output).toContain('[12 bytes]');
    expect(output).not.toContain('secret-bytes');
  });

  it('serialises a bigint', async () => {
    const output = await write({ sizeBytes: 9007199254740993n });

    expect(output).toContain('9007199254740993');
  });

  /**
   * A clinician must not be blocked from opening a file because the audit table
   * is briefly unavailable. Mutations do not use this path — they audit inside
   * their own transaction.
   */
  it('does not throw when the write fails', async () => {
    (prisma.auditLog.create as jest.Mock).mockRejectedValueOnce(new Error('table unavailable'));

    await expect(
      service.record({ action: AuditAction.READ, entityType: 'patients' }),
    ).resolves.toBeUndefined();
  });
});
