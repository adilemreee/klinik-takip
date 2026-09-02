import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  FollowUpMilestone,
  FollowUpSchedule,
  MilestoneStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { PrismaService } from '../infra/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/templates';
import { planMilestones } from './schedule';
import { DEFAULT_TEMPLATE } from './templates';

/**
 * How long after a milestone falls due before it counts as missed.
 *
 * Three days, not one: a patient who checks in on the Wednesday after a Monday
 * milestone has not missed it, and a list that says they have is a list the
 * clinic stops believing.
 */
export const MISSED_AFTER_DAYS = 3;

export interface ScheduleWithMilestones extends FollowUpSchedule {
  milestones: FollowUpMilestone[];
}

@Injectable()
export class FollowUpService {
  private readonly logger = new Logger(FollowUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Creates or replaces a patient's follow-up schedule.
   *
   * Replaces rather than adds, because an operation has one schedule: a
   * postponed date must move every check-up rather than leaving the old ones
   * beside the new ones for a clinician to tell apart.
   *
   * Milestones the patient already attended are kept. Regenerating over a
   * completed visit would ask them to come back for something they have done.
   */
  async generate(
    user: AuthenticatedUser,
    patientId: string,
    input: { surgeryDate: Date; template?: string; surgeryId?: string; timezone?: string },
  ): Promise<ScheduleWithMilestones> {
    await this.access.assertCanAccess(user, patientId);

    if (Number.isNaN(input.surgeryDate.getTime())) {
      throw new BadRequestException('A surgery date is required');
    }

    const planned = planMilestones(
      input.surgeryDate,
      input.template ?? DEFAULT_TEMPLATE,
      input.timezone,
    );

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.followUpSchedule.findFirst({
        where: { patientId },
        include: { milestones: true },
      });

      const settled = new Map(
        (existing?.milestones ?? [])
          .filter((milestone) => milestone.status === MilestoneStatus.COMPLETED)
          .map((milestone) => [milestone.label, milestone]),
      );

      if (existing) {
        await tx.followUpMilestone.deleteMany({
          where: {
            scheduleId: existing.id,
            status: { not: MilestoneStatus.COMPLETED },
          },
        });
      }

      const schedule = existing
        ? await tx.followUpSchedule.update({
            where: { id: existing.id },
            data: {
              surgeryDate: input.surgeryDate,
              template: input.template ?? DEFAULT_TEMPLATE,
              surgeryId: input.surgeryId ?? existing.surgeryId,
            },
          })
        : await tx.followUpSchedule.create({
            data: {
              patientId,
              surgeryDate: input.surgeryDate,
              template: input.template ?? DEFAULT_TEMPLATE,
              surgeryId: input.surgeryId,
            },
          });

      await tx.followUpMilestone.createMany({
        data: planned
          .filter((milestone) => !settled.has(milestone.label))
          .map((milestone) => ({
            scheduleId: schedule.id,
            label: milestone.label,
            dueAt: milestone.dueAt,
          })),
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
        entityType: 'follow_up_schedules',
        entityId: schedule.id,
        patientId,
        before: existing ?? undefined,
        after: schedule,
      });

      return {
        ...schedule,
        milestones: await tx.followUpMilestone.findMany({
          where: { scheduleId: schedule.id },
          orderBy: { dueAt: 'asc' },
        }),
      };
    });
  }

  async forPatient(
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<ScheduleWithMilestones | null> {
    await this.access.assertCanAccess(user, patientId);

    return this.prisma.followUpSchedule.findFirst({
      where: { patientId },
      include: { milestones: { orderBy: { dueAt: 'asc' } } },
    });
  }

  /** Marks a check-up attended, or deliberately skipped. */
  async setStatus(
    user: AuthenticatedUser,
    milestoneId: string,
    status: MilestoneStatus,
  ): Promise<FollowUpMilestone> {
    const milestone = await this.findInScope(user, milestoneId);

    if (status === MilestoneStatus.PENDING || status === MilestoneStatus.NOTIFIED) {
      // Those two are the scheduler's to set. A clinician moving a milestone
      // back to "not yet told" would re-notify the patient about a visit they
      // have already been reminded of.
      throw new BadRequestException('A milestone can only be completed, skipped or missed');
    }

    return this.prisma.followUpMilestone.update({
      where: { id: milestone.id },
      data: {
        status,
        completedAt: status === MilestoneStatus.COMPLETED ? new Date() : null,
      },
    });
  }

  /**
   * Notifies the milestones that have come due, and marks the ones nobody came
   * back for.
   *
   * Run on a schedule. The notification is dispatched rather than sent here:
   * whether it goes by push, SMS or e-mail, and whether it waits for quiet
   * hours, is the notification layer's decision and not this one's.
   */
  async processDue(now = new Date()): Promise<{ notified: number; missed: number }> {
    const due = await this.prisma.followUpMilestone.findMany({
      where: { status: MilestoneStatus.PENDING, dueAt: { lte: now } },
      include: { schedule: { include: { patient: { select: { userId: true } } } } },
      take: 200,
    });

    let notified = 0;

    for (const milestone of due) {
      const userId = milestone.schedule.patient.userId;

      if (userId) {
        await this.notifications.dispatch({
          userId,
          type: NOTIFICATION_TYPES.appointmentReminder,
          data: { milestoneId: milestone.id, label: milestone.label },
        });
      }

      // Marked notified even when the patient has no account yet: the clinic
      // still needs the milestone to move on, and leaving it PENDING would have
      // the sweep pick it up again every minute for a year.
      await this.prisma.followUpMilestone.update({
        where: { id: milestone.id },
        data: { status: MilestoneStatus.NOTIFIED, notifiedAt: now },
      });

      notified += 1;
    }

    const missedBefore = new Date(now.getTime() - MISSED_AFTER_DAYS * 24 * 60 * 60 * 1000);

    const missed = await this.prisma.followUpMilestone.updateMany({
      where: { status: MilestoneStatus.NOTIFIED, dueAt: { lt: missedBefore } },
      data: { status: MilestoneStatus.MISSED },
    });

    if (notified > 0 || missed.count > 0) {
      this.logger.log(`Follow-up: ${notified} notified, ${missed.count} marked missed`);
    }

    return { notified, missed: missed.count };
  }

  /** Out of scope reads as absent, never as forbidden. */
  private async findInScope(
    user: AuthenticatedUser,
    milestoneId: string,
  ): Promise<FollowUpMilestone & { schedule: FollowUpSchedule }> {
    const milestone = await this.prisma.followUpMilestone.findUnique({
      where: { id: milestoneId },
      include: { schedule: true },
    });

    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }

    await this.access.assertCanAccess(user, milestone.schedule.patientId);

    return milestone;
  }
}
