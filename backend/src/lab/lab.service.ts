import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, LabFlag, LabResult } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { PrismaService } from '../infra/prisma.service';
import type { LabCandidate } from '../ocr/lab-parser';
import { REVIEW_CONFIDENCE, classify } from './lab-flag';

export interface ReviewItem {
  result: LabResult;
  /** True when the engine was unsure enough that the field wants a second look. */
  needsAttention: boolean;
  /** Set when the printed name could not be mapped to a code. */
  awaitingMapping: boolean;
}

export interface TrendPoint {
  measuredAt: Date;
  value: number;
  flag: LabFlag | null;
  /// The range this particular result was measured against.
  refLow: number | null;
  refHigh: number | null;
}

export interface AnalyteTrend {
  analyteCode: string | null;
  analyteName: string;
  unit: string;
  points: TrendPoint[];
  /**
   * The band to draw, present only when every point shares one range.
   *
   * A laboratory can change its reference interval, and two laboratories
   * rarely agree. Drawing one band across points measured against different
   * ranges would put results on the wrong side of a line they were never
   * compared to.
   */
  reference: { low: number | null; high: number | null } | null;
  /** The most recent flag — what a summary strip shows. */
  latestFlag: LabFlag | null;
}

export interface VerifiedFields {
  analyteName?: string;
  analyteCode?: string;
  value?: number;
  unit?: string;
  refLow?: number | null;
  refHigh?: number | null;
  measuredAt?: Date;
}

@Injectable()
export class LabService {
  private readonly logger = new Logger(LabService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Files what OCR read, unverified.
   *
   * Nothing written here is clinical. Every row lands with `verifiedAt` null
   * and stays out of trends and alerts until a human confirms it (spec M16:
   * OCR output is never approved automatically).
   */
  async recordCandidates(
    patientId: string,
    documentId: string,
    candidates: LabCandidate[],
    measuredAt: Date,
  ): Promise<number> {
    if (candidates.length === 0) return 0;

    const mappings = await this.prisma.analyteMapping.findMany({
      where: { rawName: { in: candidates.map((c) => normalise(c.rawName)) } },
    });
    const byRawName = new Map(mappings.map((m) => [m.rawName, m]));

    const rows = candidates.map((candidate) => {
      const mapping = byRawName.get(normalise(candidate.rawName));

      return {
        patientId,
        documentId,
        analyteCode: mapping?.analyteCode ?? null,
        analyteName: mapping?.analyteName ?? candidate.rawName,
        value: candidate.value,
        unit: candidate.unit,
        refLow: candidate.reference?.low ?? null,
        refHigh: candidate.reference?.high ?? null,
        flag: classify(candidate.value, candidate.reference),
        measuredAt,
        ocrConfidence: candidate.confidence,
      };
    });

    await this.prisma.labResult.createMany({ data: rows });

    return rows.length;
  }

  /**
   * What is waiting for a doctor.
   *
   * Ordered doubtful-first: the point of the queue is the fields a human has to
   * look at, and burying them under the ones the engine was sure about is how a
   * reviewer starts clicking through without reading.
   */
  async pendingReview(
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<ReviewItem[]> {
    await this.access.assertCanAccess(user, patientId);

    const results = await this.prisma.labResult.findMany({
      where: { patientId, verifiedAt: null },
      orderBy: [{ ocrConfidence: 'asc' }, { id: 'asc' }],
    });

    return results.map((result) => this.toReviewItem(result));
  }

  /**
   * Confirms a result, with whatever the reviewer corrected.
   *
   * The flag is recomputed from the values as confirmed rather than kept from
   * OCR: a doctor who fixes a misread reference range has changed what normal
   * means for that row, and leaving the old flag would keep a corrected value
   * showing red.
   */
  async verify(
    user: AuthenticatedUser,
    resultId: string,
    fields: VerifiedFields,
  ): Promise<LabResult> {
    const existing = await this.findInScope(user, resultId);

    if (existing.verifiedAt) {
      throw new BadRequestException('This result has already been verified');
    }

    const value = fields.value ?? existing.value.toNumber();
    const refLow = fields.refLow !== undefined ? fields.refLow : existing.refLow?.toNumber() ?? null;
    const refHigh =
      fields.refHigh !== undefined ? fields.refHigh : existing.refHigh?.toNumber() ?? null;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.labResult.update({
        where: { id: resultId },
        data: {
          analyteName: fields.analyteName ?? existing.analyteName,
          analyteCode: fields.analyteCode ?? existing.analyteCode,
          value,
          unit: fields.unit ?? existing.unit,
          refLow,
          refHigh,
          flag: classify(value, { low: refLow, high: refHigh }),
          measuredAt: fields.measuredAt ?? existing.measuredAt,
          verifiedById: user.id,
          verifiedAt: new Date(),
        },
      });

      // The mapping is learned from the confirmation, not from the guess: a
      // doctor naming this analyte once means every later report reads it
      // without asking again (spec M16).
      if (fields.analyteCode && fields.analyteName) {
        await tx.analyteMapping.upsert({
          where: { rawName: normalise(existing.analyteName) },
          create: {
            rawName: normalise(existing.analyteName),
            analyteCode: fields.analyteCode,
            analyteName: fields.analyteName,
            unit: fields.unit ?? existing.unit,
            mappedById: user.id,
          },
          update: {
            analyteCode: fields.analyteCode,
            analyteName: fields.analyteName,
            mappedById: user.id,
          },
        });
      }

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'lab_results',
        entityId: resultId,
        patientId: existing.patientId,
        before: existing,
        after: updated,
      });

      return updated;
    });
  }

  /**
   * Discards a result the reviewer says is not one.
   *
   * OCR reads table headers and page furniture as values often enough that a
   * reviewer needs a way to say "this is not a result" — otherwise the queue
   * only grows and stops being read.
   */
  async discard(user: AuthenticatedUser, resultId: string): Promise<void> {
    const existing = await this.findInScope(user, resultId);

    if (existing.verifiedAt) {
      throw new BadRequestException('This result has already been verified');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.labResult.delete({ where: { id: resultId } });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.DELETE,
        entityType: 'lab_results',
        entityId: resultId,
        patientId: existing.patientId,
        before: existing,
      });
    });
  }

  /** Confirmed results only — the ones a trend chart may draw. */
  async verified(
    user: AuthenticatedUser,
    patientId: string,
    analyteCode?: string,
  ): Promise<LabResult[]> {
    await this.access.assertCanAccess(user, patientId);

    return this.prisma.labResult.findMany({
      where: { patientId, verifiedAt: { not: null }, analyteCode },
      orderBy: { measuredAt: 'asc' },
    });
  }

  /**
   * Confirmed results as per-analyte series (spec M2).
   *
   * Grouped by code where the analyte was mapped and by name where it was not,
   * and **also by unit**: a glucose in mg/dL and a glucose in mmol/L are the
   * same analyte and an eighteen-fold difference on the same axis. Splitting
   * them is the only reading that is not a lie.
   */
  async trends(
    user: AuthenticatedUser,
    patientId: string,
    since?: Date,
  ): Promise<AnalyteTrend[]> {
    await this.access.assertCanAccess(user, patientId);

    const results = await this.prisma.labResult.findMany({
      where: {
        patientId,
        verifiedAt: { not: null },
        measuredAt: since ? { gte: since } : undefined,
      },
      orderBy: { measuredAt: 'asc' },
    });

    const series = new Map<string, AnalyteTrend>();

    for (const result of results) {
      const key = `${result.analyteCode ?? normalise(result.analyteName)}|${result.unit}`;

      const trend = series.get(key) ?? {
        analyteCode: result.analyteCode,
        analyteName: result.analyteName,
        unit: result.unit,
        points: [],
        reference: null,
        latestFlag: null,
      };

      trend.points.push({
        measuredAt: result.measuredAt,
        value: result.value.toNumber(),
        flag: result.flag,
        refLow: result.refLow?.toNumber() ?? null,
        refHigh: result.refHigh?.toNumber() ?? null,
      });

      // Ordered oldest first, so the last one written wins and is the latest.
      trend.latestFlag = result.flag;
      series.set(key, trend);
    }

    for (const trend of series.values()) {
      trend.reference = stableReference(trend.points);
    }

    return [...series.values()].sort((a, b) => a.analyteName.localeCompare(b.analyteName, 'tr'));
  }

  /**
   * Confirmed results a doctor should see now.
   *
   * Separate from the trend list because a critical value is not something to
   * find by scrolling: spec M2 asks for it marked in red, and a screen that
   * only shows it inside a chart makes seeing it a matter of which chart the
   * doctor happened to open.
   */
  async critical(user: AuthenticatedUser, patientId: string): Promise<LabResult[]> {
    await this.access.assertCanAccess(user, patientId);

    return this.prisma.labResult.findMany({
      where: { patientId, verifiedAt: { not: null }, flag: LabFlag.CRITICAL },
      orderBy: { measuredAt: 'desc' },
    });
  }

  private toReviewItem(result: LabResult): ReviewItem {
    return {
      result,
      needsAttention: (result.ocrConfidence?.toNumber() ?? 0) < REVIEW_CONFIDENCE,
      awaitingMapping: result.analyteCode === null,
    };
  }

  private async findInScope(user: AuthenticatedUser, resultId: string): Promise<LabResult> {
    const result = await this.prisma.labResult.findUnique({ where: { id: resultId } });

    if (!result) {
      throw new NotFoundException('Lab result not found');
    }

    await this.access.assertCanAccess(user, result.patientId);

    return result;
  }
}

/**
 * The band to draw, or null when the points disagree about it.
 *
 * Returning a band anyway — the latest range, say — would draw a line the
 * older points were never measured against, and put results on the wrong side
 * of it.
 */
function stableReference(
  points: TrendPoint[],
): { low: number | null; high: number | null } | null {
  const withRange = points.filter((point) => point.refLow !== null || point.refHigh !== null);

  if (withRange.length === 0) return null;

  const first = withRange[0]!;
  const same = withRange.every(
    (point) => point.refLow === first.refLow && point.refHigh === first.refHigh,
  );

  return same ? { low: first.refLow, high: first.refHigh } : null;
}

/**
 * Mapping key for a printed analyte name.
 *
 * Case and spacing vary between laboratories printing the same analyte, and a
 * key that only matched the exact spelling would ask the doctor again for every
 * house style.
 *
 * The dotted and dotless i are folded together deliberately, and this is not
 * cosmetic: Turkish casing maps I to ı and İ to i, so "HEMOGLOBİN" and
 * "Hemoglobin" lower-case to different strings and would never match. Written
 * first with a tr-TR lower-casing, which had exactly that bug. No analyte is
 * distinguished from another only by the dot on an i, so folding is safe here
 * in a way it would not be in a name.
 */
export function normalise(rawName: string): string {
  return rawName
    .normalize('NFC')
    .replace(/[İIıi]/g, 'i')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
