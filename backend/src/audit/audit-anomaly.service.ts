import { Injectable } from '@nestjs/common';
import { AuditAction, Role } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';

export type AnomalyKind = 'BULK_ACCESS' | 'OFF_HOURS_ACCESS' | 'REPEATED_LOGIN_FAILURE';

export interface Anomaly {
  kind: AnomalyKind;
  actorId: string | null;
  actorRole: Role | null;
  count: number;
  windowStart: Date;
  windowEnd: Date;
  detail: string;
}

export interface AnomalyThresholds {
  /** Distinct patients read by one actor within the window. */
  bulkAccessPatients: number;
  /** Records read by one actor outside working hours. */
  offHoursReads: number;
  /** Failed logins for one account. */
  loginFailures: number;
  /** Local hours considered "working"; access outside these is flagged. */
  workingHours: { start: number; end: number };
}

const DEFAULTS: AnomalyThresholds = {
  bulkAccessPatients: 50,
  offHoursReads: 20,
  loginFailures: 10,
  workingHours: { start: 7, end: 21 },
};

/**
 * Detects the access patterns spec section 13 calls out: a nurse opening two
 * hundred files in one night, bulk access outside working hours.
 *
 * This is deliberately a query over the audit log rather than a real-time
 * check. The audit trail is the record of what happened; deriving alerts from
 * anything else would mean the alert and the evidence could disagree.
 *
 * Thresholds are advisory, not enforcement. Nothing here blocks a request — a
 * legitimate emergency can look exactly like exfiltration, and a system that
 * locks a nurse out mid-shift on a heuristic is more dangerous than one that
 * raises a flag for a human to read.
 */
@Injectable()
export class AuditAnomalyService {
  constructor(private readonly prisma: PrismaService) {}

  async detect(
    windowStart: Date,
    windowEnd: Date = new Date(),
    thresholds: Partial<AnomalyThresholds> = {},
  ): Promise<Anomaly[]> {
    const limits = { ...DEFAULTS, ...thresholds };

    const [bulk, offHours, failures] = await Promise.all([
      this.detectBulkAccess(windowStart, windowEnd, limits),
      this.detectOffHoursAccess(windowStart, windowEnd, limits),
      this.detectLoginFailures(windowStart, windowEnd, limits),
    ]);

    return [...bulk, ...offHours, ...failures];
  }

  private async detectBulkAccess(
    start: Date,
    end: Date,
    limits: AnomalyThresholds,
  ): Promise<Anomaly[]> {
    const rows = await this.prisma.$queryRaw<
      { actor_id: string; actor_role: Role | null; patients: bigint }[]
    >`
      SELECT actor_id, MIN(actor_role::text)::"Role" AS actor_role,
             COUNT(DISTINCT patient_id) AS patients
      FROM audit_logs
      WHERE created_at >= ${start} AND created_at < ${end}
        AND action = 'READ'::"AuditAction"
        AND actor_id IS NOT NULL
        AND patient_id IS NOT NULL
      GROUP BY actor_id
      HAVING COUNT(DISTINCT patient_id) >= ${limits.bulkAccessPatients}
    `;

    return rows.map((row) => ({
      kind: 'BULK_ACCESS' as const,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      count: Number(row.patients),
      windowStart: start,
      windowEnd: end,
      detail: `${Number(row.patients)} distinct patient files read`,
    }));
  }

  private async detectOffHoursAccess(
    start: Date,
    end: Date,
    limits: AnomalyThresholds,
  ): Promise<Anomaly[]> {
    // Hour is evaluated in the clinic's timezone, not UTC: "outside working
    // hours" is a statement about local time, and the server runs on UTC.
    const rows = await this.prisma.$queryRaw<
      { actor_id: string; actor_role: Role | null; reads: bigint }[]
    >`
      SELECT actor_id, MIN(actor_role::text)::"Role" AS actor_role, COUNT(*) AS reads
      FROM audit_logs
      WHERE created_at >= ${start} AND created_at < ${end}
        AND action = 'READ'::"AuditAction"
        AND actor_id IS NOT NULL
        AND (
          EXTRACT(HOUR FROM created_at AT TIME ZONE 'Europe/Istanbul') < ${limits.workingHours.start}
          OR EXTRACT(HOUR FROM created_at AT TIME ZONE 'Europe/Istanbul') >= ${limits.workingHours.end}
        )
      GROUP BY actor_id
      HAVING COUNT(*) >= ${limits.offHoursReads}
    `;

    return rows.map((row) => ({
      kind: 'OFF_HOURS_ACCESS' as const,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      count: Number(row.reads),
      windowStart: start,
      windowEnd: end,
      detail: `${Number(row.reads)} records read outside ${limits.workingHours.start}:00–${limits.workingHours.end}:00`,
    }));
  }

  private async detectLoginFailures(
    start: Date,
    end: Date,
    limits: AnomalyThresholds,
  ): Promise<Anomaly[]> {
    const grouped = await this.prisma.auditLog.groupBy({
      by: ['entityId'],
      where: {
        createdAt: { gte: start, lt: end },
        action: AuditAction.LOGIN_FAILED,
      },
      _count: { _all: true },
      having: { entityId: { _count: { gte: limits.loginFailures } } },
    });

    return grouped.map((row) => ({
      kind: 'REPEATED_LOGIN_FAILURE' as const,
      actorId: row.entityId,
      actorRole: null,
      count: row._count._all,
      windowStart: start,
      windowEnd: end,
      detail: `${row._count._all} failed login attempts`,
    }));
  }
}
