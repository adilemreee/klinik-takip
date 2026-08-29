import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  Document,
  DocumentType,
  ProcessingStatus,
  UploadSession,
  UploadStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { Env } from '../config/env.schema';
import { DOCUMENT_MIME_TYPES, SNIFF_LENGTH, detectType } from '../files/file-type';
import { StorageService } from '../infra/storage.service';
import { PrismaService } from '../infra/prisma.service';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { QueueService } from '../queue/queue.service';
import { peekStream } from '../files/stream-head';

/** How long an abandoned session keeps its parts before the sweep removes them. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface SessionView {
  id: string;
  /** The offset to send next. The whole protocol turns on this number. */
  receivedBytes: number;
  status: UploadStatus;
  mime: string | null;
  expiresAt: Date;
  documentId: string | null;
}

/**
 * Chunked, resumable upload (spec section 9).
 *
 * Single-shot streaming covers the clinic's own network. It does not cover the
 * patient this product is actually for: abroad, on mobile data, sending a 20 MB
 * scan. Losing the connection at 18 MB and starting again is how a document
 * ends up never being sent at all.
 */
@Injectable()
export class ResumableUploadService {
  private readonly logger = new Logger(ResumableUploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async begin(
    user: AuthenticatedUser,
    patientId: string,
    type: DocumentType,
    originalName?: string,
  ): Promise<SessionView> {
    await this.access.assertCanAccess(user, patientId);

    const session = await this.prisma.uploadSession.create({
      data: {
        patientId,
        createdById: user.id,
        documentType: type,
        originalName: originalName?.slice(0, 255),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });

    return this.view(session);
  }

  /** Where to resume from, for a client that lost its connection. */
  async status(user: AuthenticatedUser, sessionId: string): Promise<SessionView> {
    return this.view(await this.findInScope(user, sessionId));
  }

  /**
   * Accepts one chunk at `offset`.
   *
   * `offset` must equal what the server already holds. A mismatch is answered
   * with 409 and the expected offset rather than being patched up here: a
   * client that resumed from the wrong place would otherwise produce a file
   * with a hole in it, and nothing downstream would notice until a doctor
   * opened a corrupt PDF.
   *
   * That also makes a retried chunk safe. A client whose success response was
   * lost re-sends the same offset, finds it behind, and is told where the
   * server actually is.
   */
  async appendChunk(
    user: AuthenticatedUser,
    sessionId: string,
    offset: number,
    chunk: Readable,
  ): Promise<SessionView> {
    const session = await this.findInScope(user, sessionId);

    if (session.status !== UploadStatus.ACTIVE) {
      throw new ConflictException(`Upload is already ${session.status.toLowerCase()}`);
    }

    if (offset !== session.receivedBytes) {
      throw new ConflictException({
        message: 'OFFSET_MISMATCH',
        expectedOffset: session.receivedBytes,
      });
    }

    const maxBytes = this.config.get('UPLOAD_MAX_BYTES', { infer: true });
    const partKey = this.partKey(session.id, session.partCount);

    // The first chunk decides what this file is. Sniffing here rather than at
    // the end means an executable is refused after a few kilobytes instead of
    // after the patient has spent twenty megabytes of mobile data on it.
    let mime = session.mime;
    let body: Readable = chunk;

    if (session.partCount === 0) {
      const { head, stream } = await peekStream(chunk, SNIFF_LENGTH);
      const detected = detectType(head);

      if (!detected) {
        await this.abortInternal(session.id, 'Unrecognised file type');
        throw new BadRequestException('Unrecognised file type');
      }

      if (!DOCUMENT_MIME_TYPES.has(detected.mime)) {
        await this.abortInternal(session.id, `File type not allowed here: ${detected.mime}`);
        throw new BadRequestException(`File type not allowed here: ${detected.mime}`);
      }

      mime = detected.mime;
      body = stream;
    }

    const written = await this.writePart(partKey, body, maxBytes - session.receivedBytes);

    // Compare-and-set on the offset: two chunks racing for the same session
    // would otherwise both read the old value and one would be lost silently.
    const claimed = await this.prisma.uploadSession.updateMany({
      where: {
        id: session.id,
        receivedBytes: session.receivedBytes,
        partCount: session.partCount,
        status: UploadStatus.ACTIVE,
      },
      data: {
        receivedBytes: session.receivedBytes + written,
        partCount: session.partCount + 1,
        mime,
      },
    });

    if (claimed.count === 0) {
      // Another chunk won. Ours is orphaned rather than appended out of order.
      await this.storage.client
        .removeObject(this.bucket(), partKey)
        .catch(() => this.logger.warn(`Orphaned part left behind: ${partKey}`));

      const current = await this.prisma.uploadSession.findUniqueOrThrow({
        where: { id: session.id },
      });

      throw new ConflictException({
        message: 'OFFSET_MISMATCH',
        expectedOffset: current.receivedBytes,
      });
    }

    return this.view(
      await this.prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } }),
    );
  }

  /**
   * Stitches the parts into one object and creates the document.
   *
   * Assembled by streaming rather than with S3's compose, which requires every
   * part but the last to be at least 5 MB — a floor that would make resuming
   * useless on exactly the connection this exists for.
   */
  async complete(
    user: AuthenticatedUser,
    sessionId: string,
    expectedChecksum?: string,
  ): Promise<{ document: Document; jobId: string }> {
    const session = await this.findInScope(user, sessionId);

    if (session.status === UploadStatus.COMPLETED && session.documentId) {
      // A completion whose response was lost. Returning the same document is
      // the only answer that does not create a duplicate.
      const document = await this.prisma.document.findUniqueOrThrow({
        where: { id: session.documentId },
      });
      const job = await this.prisma.job.findFirst({
        where: { entityType: 'documents', entityId: document.id },
        orderBy: { id: 'desc' },
      });

      return { document, jobId: job?.id ?? '' };
    }

    if (session.status !== UploadStatus.ACTIVE) {
      throw new ConflictException(`Upload is already ${session.status.toLowerCase()}`);
    }

    if (session.receivedBytes === 0 || !session.mime) {
      throw new BadRequestException('No content was uploaded');
    }

    const { key, checksum, size } = await this.assemble(session);

    if (expectedChecksum && expectedChecksum !== checksum) {
      // The client hashed what it read from disk; we hashed what arrived. A
      // mismatch means the assembled file is not the file the patient chose,
      // and storing it would put a corrupt document in a clinical record.
      await this.storage.client.removeObject(this.bucket(), key).catch(() => undefined);
      await this.abortInternal(session.id, 'Checksum mismatch');
      throw new BadRequestException('CHECKSUM_MISMATCH');
    }

    try {
      const { result, jobId } = await this.queue.enqueue(
        {
          queue: QUEUES.documents,
          name: JOBS.documentIntake,
          data: { fileKey: key },
          entityType: 'documents',
          patientId: session.patientId,
        },
        async (tx, jobId) => {
          const document = await tx.document.create({
            data: {
              patientId: session.patientId,
              uploadedById: user.id,
              type: session.documentType,
              fileKey: key,
              originalName: session.originalName,
              mime: session.mime!,
              size,
              checksum,
              ocrStatus: ProcessingStatus.QUEUED,
            },
          });

          await tx.job.update({ where: { id: jobId }, data: { entityId: document.id } });

          await tx.uploadSession.update({
            where: { id: session.id },
            data: { status: UploadStatus.COMPLETED, documentId: document.id },
          });

          await this.audit.recordInTransaction(tx, {
            actorId: user.id,
            actorRole: user.role,
            action: AuditAction.CREATE,
            entityType: 'documents',
            entityId: document.id,
            patientId: session.patientId,
            after: document,
          });

          return document;
        },
      );

      await this.removeParts(session);

      return { document: result, jobId };
    } catch (error) {
      await this.storage.client.removeObject(this.bucket(), key).catch(() => undefined);
      throw error;
    }
  }

  async abort(user: AuthenticatedUser, sessionId: string): Promise<void> {
    const session = await this.findInScope(user, sessionId);
    await this.abortInternal(session.id, 'Aborted by the uploader');
    await this.removeParts(session);
  }

  /**
   * Removes the parts of sessions nobody came back to.
   *
   * Without this an interrupted upload leaves its bytes in the bucket for good,
   * and the bucket grows by every abandoned attempt — which on a bad connection
   * is most of them.
   */
  async sweepExpired(now = new Date()): Promise<number> {
    const stale = await this.prisma.uploadSession.findMany({
      where: { status: UploadStatus.ACTIVE, expiresAt: { lt: now } },
      take: 100,
    });

    for (const session of stale) {
      await this.removeParts(session);
      await this.prisma.uploadSession.update({
        where: { id: session.id },
        data: { status: UploadStatus.ABORTED },
      });
    }

    if (stale.length > 0) {
      this.logger.warn(`Swept ${stale.length} abandoned upload session(s)`);
    }

    return stale.length;
  }

  private async assemble(
    session: UploadSession,
  ): Promise<{ key: string; checksum: string; size: number }> {
    const key = `${new Date().getUTCFullYear()}/${String(new Date().getUTCMonth() + 1).padStart(2, '0')}/${session.id}${this.extensionFor(session.mime)}`;

    const hash = createHash('sha256');
    let size = 0;

    const output = new PassThrough();

    const feed = (async (): Promise<void> => {
      for (let part = 0; part < session.partCount; part += 1) {
        const stream = await this.storage.client.getObject(
          this.bucket(),
          this.partKey(session.id, part),
        );

        for await (const chunk of stream) {
          const buffer = chunk as Buffer;
          hash.update(buffer);
          size += buffer.length;

          if (!output.write(buffer)) {
            await new Promise((resolve) => output.once('drain', resolve));
          }
        }
      }

      output.end();
    })();

    const upload = this.storage.client.putObject(this.bucket(), key, output, undefined, {
      'Content-Type': session.mime!,
    });

    await Promise.all([feed, upload]);

    return { key, checksum: hash.digest('hex'), size };
  }

  /** Enforces the remaining budget while the chunk streams past. */
  private async writePart(key: string, body: Readable, remaining: number): Promise<number> {
    if (remaining <= 0) {
      throw new BadRequestException(
        `File exceeds the ${this.config.get('UPLOAD_MAX_BYTES', { infer: true })} byte limit`,
      );
    }

    let written = 0;
    const measured = new PassThrough();

    body.on('data', (chunk: Buffer) => {
      written += chunk.length;

      if (written > remaining) {
        measured.destroy(
          new BadRequestException(
            `File exceeds the ${this.config.get('UPLOAD_MAX_BYTES', { infer: true })} byte limit`,
          ),
        );
      }
    });

    await pipeline(body, measured, async (source) => {
      await this.storage.client.putObject(this.bucket(), key, Readable.from(source));
    });

    return written;
  }

  private async removeParts(session: UploadSession): Promise<void> {
    for (let part = 0; part < session.partCount; part += 1) {
      await this.storage.client
        .removeObject(this.bucket(), this.partKey(session.id, part))
        .catch(() => undefined);
    }
  }

  private async abortInternal(sessionId: string, reason: string): Promise<void> {
    this.logger.warn(`Upload ${sessionId} aborted: ${reason}`);
    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: UploadStatus.ABORTED },
    });
  }

  /**
   * Sessions are reachable only through the patient they belong to, and an
   * out-of-scope one reads as absent rather than forbidden.
   */
  private async findInScope(
    user: AuthenticatedUser,
    sessionId: string,
  ): Promise<UploadSession> {
    const session = await this.prisma.uploadSession.findUnique({ where: { id: sessionId } });

    if (!session) {
      throw new NotFoundException('Upload session not found');
    }

    await this.access.assertCanAccess(user, session.patientId);

    return session;
  }

  /** Parts are named by index, so a retried chunk overwrites rather than adds. */
  private partKey(sessionId: string, index: number): string {
    return `uploads/${sessionId}/${String(index).padStart(6, '0')}`;
  }

  private bucket(): string {
    return this.config.get('S3_BUCKET_DOCUMENTS', { infer: true });
  }

  private extensionFor(mime: string | null): string {
    const known: Record<string, string> = {
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/heic': '.heic',
      'application/dicom': '.dcm',
    };

    return mime ? (known[mime] ?? '') : '';
  }

  private view(session: UploadSession): SessionView {
    return {
      id: session.id,
      receivedBytes: session.receivedBytes,
      status: session.status,
      mime: session.mime,
      expiresAt: session.expiresAt,
      documentId: session.documentId,
    };
  }
}
