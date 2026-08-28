import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Measurement, MeasurementSource, MeasurementType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { PrismaService } from '../infra/prisma.service';
import { BmiCategory, calculateBmi, categoriseBmi, checkPlausible, PLAUSIBLE_RANGES } from './bmi';

export interface RecordMeasurementInput {
  type: MeasurementType;
  value: number;
  secondaryValue?: number;
  unit?: string;
  measuredAt?: Date;
  source: MeasurementSource;
  note?: string;
}

export interface SeriesPoint {
  measuredAt: Date;
  value: number;
  secondaryValue: number | null;
  unit: string;
  source: MeasurementSource;
}

/**
 * Everything the body-measurement screen draws (spec M2): the weight curve, the
 * BMI curve, and the goal line across both.
 *
 * One response rather than three, because a client that fetched the curve and
 * its goal line separately could render a chart whose halves disagree — and
 * because the screen is useless without all of it anyway.
 */
export interface BodyChart {
  weight: SeriesPoint[];
  bmi: BmiPoint[];
  targetWeightKg: number | null;
  targetBmi: number | null;
}

export interface BmiPoint {
  measuredAt: Date;
  bmi: number;
  category: BmiCategory;
  weightKg: number;
  heightCm: number;
}

@Injectable()
export class MeasurementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly audit: AuditService,
  ) {}

  async record(
    user: AuthenticatedUser,
    patientId: string,
    input: RecordMeasurementInput,
  ): Promise<Measurement> {
    await this.access.assertCanAccess(user, patientId);

    // BMI is computed from weight and height on every read, never stored — see
    // bmiSeries. A stored one would sit in `latest` beside a computed curve
    // that disagrees with it, which is the exact contradiction that design
    // exists to prevent.
    if (input.type === MeasurementType.BMI) {
      throw new BadRequestException('BMI is computed from weight and height, not recorded');
    }

    const plausible = checkPlausible(input.type, input.value, input.secondaryValue);
    if (!plausible.ok) {
      throw new BadRequestException(plausible.reason);
    }

    return this.prisma.$transaction(async (tx) => {
      const measurement = await tx.measurement.create({
        data: {
          patientId,
          type: input.type,
          value: input.value,
          secondaryValue: input.secondaryValue,
          unit: input.unit ?? PLAUSIBLE_RANGES[input.type].unit,
          measuredAt: input.measuredAt ?? new Date(),
          source: input.source,
          recordedById: user.id,
          note: input.note,
        },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.CREATE,
        entityType: 'measurements',
        entityId: measurement.id,
        patientId,
        after: measurement,
      });

      return measurement;
    });
  }

  /** One analyte over time, oldest first — the shape a chart wants. */
  async series(
    user: AuthenticatedUser,
    patientId: string,
    type: MeasurementType,
    from?: Date,
    to?: Date,
  ): Promise<SeriesPoint[]> {
    await this.access.assertCanAccess(user, patientId);

    const rows = await this.prisma.measurement.findMany({
      where: {
        patientId,
        type,
        measuredAt: from || to ? { gte: from, lte: to } : undefined,
      },
      orderBy: { measuredAt: 'asc' },
    });

    return rows.map((row) => ({
      measuredAt: row.measuredAt,
      value: row.value.toNumber(),
      secondaryValue: row.secondaryValue?.toNumber() ?? null,
      unit: row.unit,
      source: row.source,
    }));
  }

  /** The whole body-measurement screen in one read (spec M2). */
  async bodyChart(user: AuthenticatedUser, patientId: string): Promise<BodyChart> {
    const [weight, bmi, profile, heights] = await Promise.all([
      this.series(user, patientId, MeasurementType.WEIGHT),
      this.bmiSeries(user, patientId),
      this.prisma.medicalProfile.findUnique({
        where: { patientId },
        select: { targetWeightKg: true },
      }),
      this.prisma.measurement.findMany({
        where: { patientId, type: MeasurementType.HEIGHT },
        orderBy: { measuredAt: 'desc' },
        take: 1,
      }),
    ]);

    const target = profile?.targetWeightKg?.toNumber() ?? null;
    const latestHeight = heights[0]?.value.toNumber();

    return {
      weight,
      bmi,
      targetWeightKg: target,
      // The same goal on the BMI axis, computed here rather than on each client
      // so two apps cannot draw the line in two places.
      targetBmi: target !== null && latestHeight ? calculateBmi(target, latestHeight) : null,
    };
  }

  /**
   * The BMI curve.
   *
   * Computed rather than stored, and each point uses the height recorded at or
   * before that weight. Two reasons:
   *
   * A stored BMI goes stale the moment a height is corrected — and heights are
   * corrected, because 17 cm and 170 cm are one keystroke apart. Computing means
   * the whole curve heals itself instead of silently disagreeing with the
   * weights beside it.
   *
   * Using the height in effect at the time, rather than the latest, keeps the
   * history honest for the patients whose height genuinely changes.
   */
  async bmiSeries(user: AuthenticatedUser, patientId: string): Promise<BmiPoint[]> {
    await this.access.assertCanAccess(user, patientId);

    const [weights, heights] = await Promise.all([
      this.prisma.measurement.findMany({
        where: { patientId, type: MeasurementType.WEIGHT },
        orderBy: { measuredAt: 'asc' },
      }),
      this.prisma.measurement.findMany({
        where: { patientId, type: MeasurementType.HEIGHT },
        orderBy: { measuredAt: 'asc' },
      }),
    ]);

    if (heights.length === 0) {
      // Without a height there is no BMI. An empty curve is the honest answer;
      // guessing a height would put a number on a chart that no one measured.
      return [];
    }

    return weights.map((weight) => {
      const heightCm = this.heightAt(heights, weight.measuredAt);
      const bmi = calculateBmi(weight.value.toNumber(), heightCm);

      return {
        measuredAt: weight.measuredAt,
        bmi,
        category: categoriseBmi(bmi),
        weightKg: weight.value.toNumber(),
        heightCm,
      };
    });
  }

  /**
   * The height in effect at a moment: the most recent one recorded at or before
   * it, falling back to the earliest known height for weights taken before any
   * height was measured.
   */
  private heightAt(heights: Measurement[], at: Date): number {
    let chosen = heights[0]!;

    for (const height of heights) {
      if (height.measuredAt <= at) {
        chosen = height;
      } else {
        break;
      }
    }

    return chosen.value.toNumber();
  }

  /**
   * The patient file belonging to the caller.
   *
   * Resolved through the access filter, so a patient reaches exactly their own
   * and a consented caregiver reaches the one they are linked to.
   */
  async ownPatientId(user: AuthenticatedUser): Promise<string> {
    const scope = await this.access.scopeFilter(user);
    const patient = await this.prisma.patient.findFirst({ where: scope, select: { id: true } });

    if (!patient) {
      throw new NotFoundException('No patient file for this account');
    }

    return patient.id;
  }

  /** The latest reading of each type — the "patient summary" strip (spec M2). */
  async latest(
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<Partial<Record<MeasurementType, SeriesPoint>>> {
    await this.access.assertCanAccess(user, patientId);

    const rows = await this.prisma.measurement.findMany({
      where: { patientId },
      orderBy: { measuredAt: 'desc' },
      distinct: ['type'],
    });

    const latest: Partial<Record<MeasurementType, SeriesPoint>> = {};

    for (const row of rows) {
      latest[row.type] = {
        measuredAt: row.measuredAt,
        value: row.value.toNumber(),
        secondaryValue: row.secondaryValue?.toNumber() ?? null,
        unit: row.unit,
        source: row.source,
      };
    }

    return latest;
  }
}
