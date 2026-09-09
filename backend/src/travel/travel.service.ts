import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, type TravelPlan } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { PatientAccessService } from '../authz/patient-access.service';
import { PrismaService } from '../infra/prisma.service';

export interface TravelPlanView {
  plan: TravelPlan | null;
  /** Who signed off the flight, when somebody has. */
  clearedToFlyBy: string | null;
}

export type TravelPlanInput = Omit<
  Prisma.TravelPlanUncheckedCreateInput,
  'id' | 'patientId' | 'createdAt' | 'updatedAt' | 'version' | 'clearedToFlyAt' | 'clearedToFlyById'
>;

/**
 * The travel around an operation (spec M19).
 *
 * Deliberately not part of the clinical record. A coordinator books hotels and
 * meets people at the airport without holding `medical.read`, and folding this
 * into the patient file would either widen that permission or leave the person
 * doing the job unable to do it.
 *
 * One thing here *is* clinical, and it is handled as such: whether the patient
 * may fly. That is a judgement about a specific operation on a specific person,
 * so it is recorded with the clinician who made it rather than computed from a
 * date — an app that worked out a waiting period from a surgery date would be
 * issuing medical advice nobody reviewed.
 */
@Injectable()
export class TravelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly audit: AuditService,
  ) {}

  async forPatient(user: AuthenticatedUser, patientId: string): Promise<TravelPlanView> {
    await this.access.assertCanAccess(user, patientId);

    const plan = await this.prisma.travelPlan.findUnique({ where: { patientId } });

    return { plan, clearedToFlyBy: await this.clearedBy(plan) };
  }

  /** What the patient sees about their own trip. */
  async mine(user: AuthenticatedUser): Promise<TravelPlanView> {
    const scope = await this.access.scopeFilter(user);
    const patient = await this.prisma.patient.findFirst({ where: scope, select: { id: true } });

    if (!patient) throw new NotFoundException('No patient file');

    const plan = await this.prisma.travelPlan.findUnique({ where: { patientId: patient.id } });

    return { plan, clearedToFlyBy: await this.clearedBy(plan) };
  }

  async upsert(
    user: AuthenticatedUser,
    patientId: string,
    input: TravelPlanInput,
    expectedVersion?: number,
  ): Promise<TravelPlan> {
    await this.access.assertCanAccess(user, patientId);

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.travelPlan.findUnique({ where: { patientId } });

      if (expectedVersion !== undefined && before && before.version !== expectedVersion) {
        throw new ConflictException({
          statusCode: 409,
          message: 'travel_plans changed since it was read',
          expectedVersion,
          actualVersion: before.version,
        });
      }

      const plan = await tx.travelPlan.upsert({
        where: { patientId },
        create: { patientId, ...input },
        update: { ...input, version: { increment: 1 } },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: before ? AuditAction.UPDATE : AuditAction.CREATE,
        entityType: 'travel_plans',
        entityId: plan.id,
        patientId,
        before,
        after: plan,
      });

      return plan;
    });
  }

  /**
   * Records that a clinician says this patient may fly, or withdraws it.
   *
   * Separate from the rest of the plan because it is the one clinical statement
   * on it: a coordinator may move a hotel booking and may not decide somebody
   * is fit to sit on an aeroplane for four hours.
   */
  async setClearedToFly(
    user: AuthenticatedUser,
    patientId: string,
    cleared: boolean,
  ): Promise<TravelPlan> {
    await this.access.assertCanAccess(user, patientId);

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.travelPlan.findUnique({ where: { patientId } });

      const plan = await tx.travelPlan.upsert({
        where: { patientId },
        create: {
          patientId,
          clearedToFlyAt: cleared ? new Date() : null,
          clearedToFlyById: cleared ? user.id : null,
        },
        update: {
          clearedToFlyAt: cleared ? new Date() : null,
          clearedToFlyById: cleared ? user.id : null,
          version: { increment: 1 },
        },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'travel_plans',
        entityId: plan.id,
        patientId,
        before,
        after: plan,
      });

      return plan;
    });
  }

  private async clearedBy(plan: TravelPlan | null): Promise<string | null> {
    if (!plan?.clearedToFlyById) return null;

    const staff = await this.prisma.staffProfile.findFirst({
      where: { userId: plan.clearedToFlyById },
      select: { firstName: true, lastName: true, title: true },
    });

    if (!staff) return null;

    return [staff.title, staff.firstName, staff.lastName].filter(Boolean).join(' ');
  }
}
