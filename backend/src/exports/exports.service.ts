import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  ExportKind,
  Prisma,
  ProcessingStatus,
  type Export,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { FileService } from '../files/file.service';
import { PrismaService } from '../infra/prisma.service';
import type { RequestContext } from '../patients/patients.service';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.service';

/**
 * Files that contain patient data and leave the building (spec M12, T6.5).
 *
 * The specification asks for four things and each one is a decision here:
 * exports are produced on a queue, the link is short-lived and signed, a
 * notification says when it is ready, and **every export is audited**.
 *
 * The audit entry is written when the file is finished rather than when it is
 * requested, and it carries the manifest of what actually went in — a request
 * that failed halfway is not a disclosure, and "a summary was exported" without
 * saying whether it contained photographs answers none of the questions an
 * investigation would ask.
 */

export interface SummaryOptions {
  /**
   * Photographs. Off unless asked for: they are the most sensitive thing an
   * export can carry, and a face is not something a signed URL can take back.
   */
  includePhotos?: boolean;
}

/** How long a rendered export stays in storage before the sweep deletes it. */
export const EXPORT_TTL_DAYS = 7;

/** The download link itself is far shorter-lived than the file. */
export const DOWNLOAD_TTL_SECONDS = 300;

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly queue: QueueService,
    private readonly files: FileService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Asks for a patient summary.
   *
   * Returns immediately with a row to poll; the rendering happens on the
   * queue. The patient scope is checked here, at request time, so somebody
   * without access gets the same 404 they would get anywhere else.
   */
  async requestPatientSummary(
    user: AuthenticatedUser,
    patientId: string,
    options: SummaryOptions = {},
  ): Promise<Export> {
    await this.access.assertCanAccess(user, patientId);

    const { result } = await this.queue.enqueue(
      {
        queue: QUEUES.exports,
        name: JOBS.exportRender,
        entityType: 'exports',
        patientId,
        data: {},
      },
      async (tx, jobId) => {
        const row = await tx.export.create({
          data: {
            kind: ExportKind.PATIENT_SUMMARY,
            requestedById: user.id,
            patientId,
            params: { includePhotos: options.includePhotos === true, jobId },
          },
        });

        return row;
      },
    );

    this.logger.log(`Export ${result.id} requested for patient ${patientId}`);

    return result;
  }

  async get(user: AuthenticatedUser, id: string): Promise<Export> {
    const row = await this.prisma.export.findUnique({ where: { id } });

    // Somebody else's export is not visible, and "not yours" and "no such
    // export" are the same answer for the same reason they are everywhere else.
    if (!row || row.requestedById !== user.id) {
      throw new NotFoundException('Export not found');
    }

    return row;
  }

  async list(user: AuthenticatedUser, limit = 20): Promise<Export[]> {
    return this.prisma.export.findMany({
      where: { requestedById: user.id },
      orderBy: { id: 'desc' },
      take: Math.min(limit, 100),
    });
  }

  /**
   * A short-lived signed link, and a note that it was handed out.
   *
   * The moment the link is created is the moment the data can leave, so that is
   * what the audit records — not the moment the file was made.
   */
  async download(
    user: AuthenticatedUser,
    id: string,
    context: RequestContext = {},
  ): Promise<{ url: string; expiresAt: Date; filename: string }> {
    const row = await this.get(user, id);

    if (row.status !== ProcessingStatus.DONE || !row.fileKey) {
      throw new NotFoundException('Export is not ready');
    }

    if (row.expiresAt && row.expiresAt < new Date()) {
      // The object is gone or about to be; saying so beats a signed URL that
      // 404s at the storage layer.
      throw new NotFoundException('Export has expired');
    }

    const filename = `hasta-ozeti-${row.id.slice(0, 8)}.pdf`;

    const link = await this.files.createDownloadUrl('documents', row.fileKey, {
      filename,
      expiresIn: DOWNLOAD_TTL_SECONDS,
    });

    await this.prisma.export.update({
      where: { id },
      data: { downloadedAt: new Date() },
    });

    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.EXPORT,
      entityType: 'exports',
      entityId: id,
      patientId: row.patientId ?? undefined,
      after: { downloaded: true, kind: row.kind, expiresAt: link.expiresAt },
      ...context,
    });

    return { ...link, filename };
  }

  /**
   * Deletes the stored objects of expired exports.
   *
   * The row stays — the audit trail of what was exported must outlive the file
   * — and only the bytes go.
   */
  async sweepExpired(now = new Date(), batch = 100): Promise<number> {
    const expired = await this.prisma.export.findMany({
      where: {
        fileKey: { not: null },
        expiresAt: { lt: now },
      },
      take: batch,
    });

    let removed = 0;

    for (const row of expired) {
      try {
        if (row.fileKey) await this.files.remove('documents', row.fileKey);

        await this.prisma.export.update({
          where: { id: row.id },
          data: { fileKey: null, status: ProcessingStatus.DONE },
        });

        removed += 1;
      } catch (error) {
        // One unremovable object must not stop the rest of the sweep; the row
        // keeps its key and the next run tries again.
        this.logger.error(`Could not remove expired export ${row.id}: ${String(error)}`);
      }
    }

    if (removed > 0) this.logger.log(`Removed ${removed} expired export objects`);

    return removed;
  }

  /** Called by the processor when a render finishes. */
  async recordResult(
    id: string,
    result: {
      fileKey: string;
      mime: string;
      size: number;
      contents: Prisma.InputJsonValue;
    },
  ): Promise<Export> {
    const row = await this.prisma.export.update({
      where: { id },
      data: {
        status: ProcessingStatus.DONE,
        fileKey: result.fileKey,
        mime: result.mime,
        size: result.size,
        contents: result.contents,
        finishedAt: new Date(),
        expiresAt: new Date(Date.now() + EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    const requester = await this.prisma.user.findUnique({
      where: { id: row.requestedById },
      select: { role: true },
    });

    // The audit entry the specification asks for: who took what data out, when,
    // and — from the manifest — what was actually in it.
    await this.audit.record({
      actorId: row.requestedById,
      actorRole: requester?.role,
      action: AuditAction.EXPORT,
      entityType: 'exports',
      entityId: row.id,
      patientId: row.patientId ?? undefined,
      after: { kind: row.kind, size: result.size, contents: result.contents },
    });

    return row;
  }

  async recordFailure(id: string, error: string): Promise<void> {
    await this.prisma.export.update({
      where: { id },
      data: {
        status: ProcessingStatus.FAILED,
        // The message is kept for the person who asked, so never anything from
        // the patient's record.
        error: error.slice(0, 500),
        finishedAt: new Date(),
      },
    });
  }

  async markStarted(id: string): Promise<void> {
    await this.prisma.export.update({
      where: { id },
      data: { status: ProcessingStatus.PROCESSING, startedAt: new Date() },
    });
  }
}
