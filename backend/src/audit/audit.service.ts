import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';

export interface AuditEntry {
  actorId?: string;
  actorRole?: Role;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  /** The patient whose record this touched, for "who looked at X" queries. */
  patientId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

/**
 * Field names whose values never enter an audit record.
 *
 * The audit log is read by staff investigating access, and is retained for
 * years. A password hash or TOTP secret captured in a `before` snapshot would
 * outlive every rotation of the credential it protects.
 */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordhash',
  'passwordHash',
  'totpsecret',
  'totpSecret',
  'refreshtoken',
  'refreshTokenHash',
  'codehash',
  'codeHash',
  'token',
  'accesstoken',
  'refreshtokenhash',
  'secret',
  'encryptionkey',
  'signature',
]);

const MAX_DEPTH = 6;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes inside a caller-supplied transaction.
   *
   * This is the only correct way to audit a mutation: if the audit insert and
   * the change are separate, a failure between them leaves either a change with
   * no record or a record of a change that did not happen. Both are worse than
   * failing the request.
   */
  async recordInTransaction(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({ data: this.toRow(entry) });
  }

  /**
   * Writes outside a transaction, for reads and authentication events.
   *
   * A failure here is logged loudly but does not fail the request: refusing to
   * show a nurse a patient file because the audit table is briefly unavailable
   * would be the wrong trade in a clinic. Mutations do not use this path.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: this.toRow(entry) });
    } catch (error) {
      this.logger.error(
        `AUDIT WRITE FAILED — ${entry.action} ${entry.entityType} by ${entry.actorId ?? 'anonymous'}: ${String(error)}`,
      );
    }
  }

  private toRow(entry: AuditEntry): Prisma.AuditLogCreateInput {
    return {
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      patientId: entry.patientId,
      before: this.redact(entry.before) as Prisma.InputJsonValue,
      after: this.redact(entry.after) as Prisma.InputJsonValue,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      requestId: entry.requestId,
    };
  }

  /**
   * Recursively replaces sensitive values with a marker. Depth-limited so a
   * cyclic or pathologically nested payload cannot stall the request.
   */
  private redact(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (depth >= MAX_DEPTH) {
      return '[truncated]';
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item, depth + 1));
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};

      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        result[key] = REDACTED_FIELDS.has(key) || REDACTED_FIELDS.has(key.toLowerCase())
          ? '[redacted]'
          : this.redact(item, depth + 1);
      }

      return result;
    }

    return value;
  }
}
