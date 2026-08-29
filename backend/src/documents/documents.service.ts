import type { Readable } from 'node:stream';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  Document,
  DocumentType,
  Job,
  ProcessingStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { Env } from '../config/env.schema';
import { DOCUMENT_MIME_TYPES } from '../files/file-type';
import { FileService } from '../files/file.service';
import { PrismaService } from '../infra/prisma.service';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.service';

export interface UploadedPart {
  stream: Readable;
  filename?: string;
}

export interface DocumentListItem {
  id: string;
  type: DocumentType;
  originalName: string | null;
  mime: string;
  size: number;
  ocrStatus: ProcessingStatus;
  createdAt: Date;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly audit: AuditService,
    private readonly files: FileService,
    private readonly queue: QueueService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Stores an upload and queues it for processing.
   *
   * The bytes go to object storage first, then the row and the job are written
   * in one transaction. The reverse order would mean a row pointing at an
   * object that does not exist — a document the clinic believes it has. This
   * way a failed transaction leaves an orphaned object instead, which is
   * garbage rather than a lie, and is deleted below.
   */
  async upload(
    user: AuthenticatedUser,
    patientId: string,
    part: UploadedPart,
    type: DocumentType,
  ): Promise<{ document: Document; jobId: string }> {
    await this.access.assertCanAccess(user, patientId);

    const stored = await this.files.upload(part.stream, {
      bucket: 'documents',
      allowedMimeTypes: DOCUMENT_MIME_TYPES,
      maxBytes: this.config.get('UPLOAD_MAX_BYTES', { infer: true }),
      originalName: part.filename,
    });

    try {
      const { result, jobId } = await this.queue.enqueue(
        {
          queue: QUEUES.documents,
          name: JOBS.documentIntake,
          data: { fileKey: stored.key },
          entityType: 'documents',
          patientId,
        },
        async (tx, jobId) => {
          const document = await tx.document.create({
            data: {
              patientId,
              uploadedById: user.id,
              type,
              fileKey: stored.key,
              originalName: part.filename?.slice(0, 255),
              mime: stored.mime,
              size: stored.size,
              checksum: stored.checksum,
              ocrStatus: ProcessingStatus.QUEUED,
            },
          });

          await tx.job.update({
            where: { id: jobId },
            data: { entityId: document.id },
          });

          await this.audit.recordInTransaction(tx, {
            actorId: user.id,
            actorRole: user.role,
            action: AuditAction.CREATE,
            entityType: 'documents',
            entityId: document.id,
            patientId,
            // The key and checksum, never the contents.
            after: { ...document, fileKey: document.fileKey },
          });

          return document;
        },
      );

      return { document: result, jobId };
    } catch (error) {
      // The row was never written, so nothing refers to these bytes.
      await this.files
        .remove('documents', stored.key)
        .catch(() => this.logger.error(`Orphaned object left behind: documents/${stored.key}`));

      throw error;
    }
  }

  async list(
    user: AuthenticatedUser,
    patientId: string,
    options: { cursor?: string; limit?: number; type?: DocumentType } = {},
  ): Promise<{ items: DocumentListItem[]; nextCursor: string | null }> {
    await this.access.assertCanAccess(user, patientId);

    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);

    const rows = await this.prisma.document.findMany({
      where: { patientId, deletedAt: null, type: options.type },
      // Ids are UUIDv7, so this is newest-first and a stable cursor even for
      // rows created in the same millisecond.
      orderBy: { id: 'desc' },
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        originalName: true,
        mime: true,
        size: true,
        ocrStatus: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
  }

  /**
   * A short-lived signed URL, and an audit entry.
   *
   * Reading a document is a clinical access event: who looked at which patient's
   * file, and when (spec M13). The URL is minted per request rather than stored.
   */
  async downloadUrl(
    user: AuthenticatedUser,
    documentId: string,
  ): Promise<{ url: string; expiresAt: Date; filename: string }> {
    const document = await this.findInScope(user, documentId);

    const filename = document.originalName ?? `document-${document.id}`;
    const { url, expiresAt } = await this.files.createDownloadUrl(
      'documents',
      document.fileKey,
      { filename },
    );

    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.READ,
      entityType: 'documents',
      entityId: document.id,
      patientId: document.patientId,
    });

    return { url, expiresAt, filename };
  }

  /**
   * Soft delete.
   *
   * The bytes stay: clinical records have a legal retention period (spec
   * section 8), and a deletion a patient asked for is not permission to destroy
   * evidence the clinic is required to keep. Purging happens on the retention
   * schedule, not here.
   */
  async remove(user: AuthenticatedUser, documentId: string): Promise<void> {
    const document = await this.findInScope(user, documentId);

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.document.update({
        where: { id: document.id },
        data: { deletedAt: new Date() },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.DELETE,
        entityType: 'documents',
        entityId: document.id,
        patientId: document.patientId,
        before: document,
        after: updated,
      });
    });
  }

  /** Every job recorded against a document, newest first. */
  async jobsFor(user: AuthenticatedUser, documentId: string): Promise<Job[]> {
    const document = await this.findInScope(user, documentId);

    return this.prisma.job.findMany({
      where: { entityType: 'documents', entityId: document.id },
      orderBy: { id: 'desc' },
    });
  }

  /**
   * Resolves a document, or reports it missing.
   *
   * Out of scope and absent give the same answer: a 403 here would confirm that
   * a given document — and therefore a given patient — exists.
   */
  private async findInScope(user: AuthenticatedUser, documentId: string): Promise<Document> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    await this.access.assertCanAccess(user, document.patientId);

    return document;
  }
}
