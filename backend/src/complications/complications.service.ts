import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  Complication,
  ComplicationStatus,
  Photo,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { PrismaService } from '../infra/prisma.service';

/**
 * How long a report may wait before the queue calls it overdue.
 *
 * Two hours, not two minutes: this is not the emergency button, and treating
 * every wound question as an alarm is how a queue of alarms stops being read.
 * It is also not a day, because the thing a patient photographs is usually the
 * thing they have been worrying about since yesterday.
 */
export const OVERDUE_AFTER_MINUTES = 120;

export interface ComplicationView {
  complication: Complication;
  photos: Photo[];
  /** Minutes from report to first answer, or to now while still waiting. */
  waitingMinutes: number;
  /** Null until someone answered. */
  responseMinutes: number | null;
  overdue: boolean;
}

export interface ReportInput {
  note: string;
  bodyArea?: string;
  photoIds?: string[];
}

@Injectable()
export class ComplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly audit: AuditService,
  ) {}

  /**
   * A patient reporting something wrong.
   *
   * The photos are attached in the same transaction as the report, and only
   * ones already belonging to this patient: a report referring to a photo it
   * does not own would either show a clinician the wrong body or show them
   * nothing, and both are worse than refusing.
   */
  async report(
    user: AuthenticatedUser,
    patientId: string,
    input: ReportInput,
  ): Promise<ComplicationView> {
    await this.access.assertCanAccess(user, patientId);

    const note = input.note.trim();

    if (note.length === 0) {
      // A photo with no words leaves the clinician guessing what they are being
      // asked to look at.
      throw new BadRequestException('Describe what is wrong');
    }

    const photoIds = input.photoIds ?? [];

    if (photoIds.length > 0) {
      const owned = await this.prisma.photo.count({
        where: { id: { in: photoIds }, patientId, deletedAt: null },
      });

      if (owned !== photoIds.length) {
        throw new NotFoundException('One or more photos were not found for this patient');
      }
    }

    const complication = await this.prisma.$transaction(async (tx) => {
      const created = await tx.complication.create({
        data: {
          patientId,
          note: note.slice(0, 2000),
          bodyArea: input.bodyArea?.slice(0, 100),
          reportedById: user.id,
          status: ComplicationStatus.REPORTED,
        },
      });

      if (photoIds.length > 0) {
        await tx.photo.updateMany({
          where: { id: { in: photoIds }, patientId },
          data: { complicationId: created.id },
        });
      }

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.CREATE,
        entityType: 'complications',
        entityId: created.id,
        patientId,
        after: created,
      });

      return created;
    });

    return this.view(complication, await this.photosOf(complication.id));
  }

  /**
   * The clinician's queue: everything still waiting, longest first.
   *
   * Scoped like every other clinical read, so a nurse sees the patients they
   * are responsible for and not the clinic's whole caseload. Ordered by how
   * long the patient has been waiting rather than by when it arrived, which is
   * the same thing here and says what the order is for.
   */
  async queue(
    user: AuthenticatedUser,
    includeResolved = false,
  ): Promise<ComplicationView[]> {
    const scope = await this.access.scopeFilter(user);

    const complications = await this.prisma.complication.findMany({
      where: {
        patient: scope,
        status: includeResolved
          ? undefined
          : { in: [ComplicationStatus.REPORTED, ComplicationStatus.ACKNOWLEDGED] },
      },
      orderBy: { reportedAt: 'asc' },
      include: { photos: { where: { deletedAt: null } } },
    });

    return complications.map((row) => this.view(row, row.photos));
  }

  /** One patient's reports, newest first — the history on their file. */
  async forPatient(user: AuthenticatedUser, patientId: string): Promise<ComplicationView[]> {
    await this.access.assertCanAccess(user, patientId);

    const complications = await this.prisma.complication.findMany({
      where: { patientId },
      orderBy: { reportedAt: 'desc' },
      include: { photos: { where: { deletedAt: null } } },
    });

    return complications.map((row) => this.view(row, row.photos));
  }

  /**
   * A clinician answering.
   *
   * The first answer is what the response time is measured against, so it is
   * recorded once and never moved: a second clinician adding a note must not
   * make the clinic look faster than it was.
   */
  async acknowledge(
    user: AuthenticatedUser,
    complicationId: string,
    response: string,
  ): Promise<ComplicationView> {
    const existing = await this.findInScope(user, complicationId);

    if (existing.status === ComplicationStatus.RESOLVED) {
      throw new BadRequestException('This report is already resolved');
    }

    if (existing.acknowledgedAt) {
      throw new BadRequestException('This report has already been answered');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.complication.update({
        where: { id: complicationId },
        data: {
          status: ComplicationStatus.ACKNOWLEDGED,
          acknowledgedById: user.id,
          acknowledgedAt: new Date(),
          firstResponse: response.trim().slice(0, 2000),
        },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'complications',
        entityId: complicationId,
        patientId: existing.patientId,
        before: existing,
        after: row,
      });

      return row;
    });

    return this.view(updated, await this.photosOf(complicationId));
  }

  /**
   * Closing a report.
   *
   * Resolving one nobody answered also stamps the acknowledgement, because a
   * clinician who read it and dealt with it in one step did answer — leaving
   * the field empty would record that report as never responded to and quietly
   * corrupt the only number this feature exists to produce.
   */
  async resolve(
    user: AuthenticatedUser,
    complicationId: string,
    resolution: string,
  ): Promise<ComplicationView> {
    const existing = await this.findInScope(user, complicationId);

    if (existing.status === ComplicationStatus.RESOLVED) {
      throw new BadRequestException('This report is already resolved');
    }

    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.complication.update({
        where: { id: complicationId },
        data: {
          status: ComplicationStatus.RESOLVED,
          resolvedById: user.id,
          resolvedAt: now,
          resolution: resolution.trim().slice(0, 2000),
          acknowledgedById: existing.acknowledgedById ?? user.id,
          acknowledgedAt: existing.acknowledgedAt ?? now,
          firstResponse: existing.firstResponse ?? resolution.trim().slice(0, 2000),
        },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'complications',
        entityId: complicationId,
        patientId: existing.patientId,
        before: existing,
        after: row,
      });

      return row;
    });

    return this.view(updated, await this.photosOf(complicationId));
  }

  private async photosOf(complicationId: string): Promise<Photo[]> {
    return this.prisma.photo.findMany({
      where: { complicationId, deletedAt: null },
      orderBy: { takenAt: 'asc' },
    });
  }

  /** Out of scope reads as absent, never as forbidden. */
  private async findInScope(
    user: AuthenticatedUser,
    complicationId: string,
  ): Promise<Complication> {
    const complication = await this.prisma.complication.findUnique({
      where: { id: complicationId },
    });

    if (!complication) {
      throw new NotFoundException('Complication report not found');
    }

    await this.access.assertCanAccess(user, complication.patientId);

    return complication;
  }

  private view(complication: Complication, photos: Photo[]): ComplicationView {
    const answeredAt = complication.acknowledgedAt;
    const reference = answeredAt ?? new Date();
    const waitingMs = reference.getTime() - complication.reportedAt.getTime();

    return {
      complication,
      photos,
      waitingMinutes: Math.max(0, Math.round(waitingMs / 60_000)),
      responseMinutes: answeredAt
        ? Math.max(0, Math.round((answeredAt.getTime() - complication.reportedAt.getTime()) / 60_000))
        : null,
      // Only an unanswered report can be overdue: once it has been answered the
      // number is history, not a thing to chase.
      overdue: !answeredAt && waitingMs >= OVERDUE_AFTER_MINUTES * 60_000,
    };
  }
}
