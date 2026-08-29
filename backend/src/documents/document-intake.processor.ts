import { Logger } from '@nestjs/common';
import { ProcessingStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { FileService } from '../files/file.service';
import { PrismaService } from '../infra/prisma.service';
import type { JobHandler } from '../queue/job-runner';

/**
 * Intake: confirming the upload is really there.
 *
 * An upload can return 201 and still leave nothing usable behind — storage
 * accepted the write and lost it, the object was truncated, the row and the
 * object disagree about the size. The symptom of that is a doctor opening a lab
 * report weeks later and finding an empty file, long after anyone could ask the
 * patient to send it again.
 *
 * Checking now means the clinic learns about it while the patient is still
 * reachable. It is also what makes the OCR stage in T3.3 able to assume the
 * bytes exist.
 */
/**
 * Releases the parts of uploads nobody came back to (spec section 9).
 *
 * Housekeeping, so a run that finds nothing is not worth a record — the handler
 * simply returns and the wrapper marks the job done.
 */
export function uploadSweep(uploads: { sweepExpired: () => Promise<number> }): JobHandler {
  const logger = new Logger('UploadSweep');

  return async (): Promise<void> => {
    const removed = await uploads.sweepExpired();

    if (removed > 0) {
      logger.warn(`Released ${removed} abandoned upload session(s)`);
    }
  };
}

export function documentIntake(prisma: PrismaService, files: FileService): JobHandler {
  const logger = new Logger('DocumentIntake');

  return async (job: Job): Promise<void> => {
    const data = job.data as { jobId?: string };
    const record = data.jobId
      ? await prisma.job.findUnique({ where: { id: data.jobId }, select: { entityId: true } })
      : null;

    const documentId = record?.entityId;

    if (!documentId) {
      throw new Error('Intake job carries no document id');
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, fileKey: true, size: true },
    });

    if (!document) {
      // Uploaded and then deleted before the worker got to it. Nothing to do,
      // and nothing wrong.
      logger.log(`Document ${documentId} is gone; nothing to verify`);
      return;
    }

    const stat = await files.stat('documents', document.fileKey);

    if (stat.size !== document.size) {
      // Deliberately fails the job: a size mismatch means the stored bytes are
      // not the bytes that were checksummed, and treating that as fine would
      // hand a corrupted file to the OCR stage as if it were sound.
      throw new Error(
        `Stored object is ${stat.size} bytes but the record says ${document.size}`,
      );
    }

    // Verified and ready for the OCR stage, which T3.3 adds. PENDING here means
    // "waiting for OCR", not "waiting for intake".
    await prisma.document.update({
      where: { id: document.id },
      data: { ocrStatus: ProcessingStatus.PENDING },
    });
  };
}
