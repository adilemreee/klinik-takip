import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { ProcessingStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { FileService } from '../files/file.service';
import { PrismaService } from '../infra/prisma.service';
import { StorageService } from '../infra/storage.service';
import { LabService } from '../lab/lab.service';
import type { JobHandler } from '../queue/job-runner';
import { parseLabLines, type LabCandidate } from './lab-parser';
import type { OcrEngine } from './ocr-engine';
import { rasterisePdf } from './pdf-raster';

/** Types worth reading. A passport or an invoice has no lab values on it. */
const OCR_TYPES = new Set(['LAB', 'REPORT', 'ECG', 'IMAGING']);

export interface OcrDependencies {
  prisma: PrismaService;
  files: FileService;
  storage: StorageService;
  lab: LabService;
  engine: OcrEngine;
  bucket: string;
}

/**
 * Reads a document and files what it found for a human to confirm.
 *
 * The output of this job is never clinical. Every value it produces lands
 * unverified and stays out of trends and alerts until a doctor confirms it
 * (spec M16: OCR output is never approved automatically). The job's real
 * purpose is saving typing, not making decisions.
 */
export function documentOcr(deps: OcrDependencies): JobHandler {
  const logger = new Logger('DocumentOcr');

  return async (job: Job): Promise<void> => {
    const data = job.data as { jobId?: string };
    const record = data.jobId
      ? await deps.prisma.job.findUnique({ where: { id: data.jobId }, select: { entityId: true } })
      : null;

    const documentId = record?.entityId;
    if (!documentId) throw new Error('OCR job carries no document id');

    const document = await deps.prisma.document.findUnique({ where: { id: documentId } });

    if (!document || document.deletedAt) {
      logger.log(`Document ${documentId} is gone; nothing to read`);
      return;
    }

    if (!OCR_TYPES.has(document.type)) {
      // A passport has no lab values on it. Skipped is the honest state — not
      // done, which would suggest something was read.
      await deps.prisma.document.update({
        where: { id: document.id },
        data: { ocrStatus: ProcessingStatus.SKIPPED },
      });
      return;
    }

    await deps.prisma.document.update({
      where: { id: document.id },
      data: { ocrStatus: ProcessingStatus.PROCESSING },
    });

    const workspace = await mkdtemp(join(tmpdir(), 'klinik-ocr-'));

    try {
      const candidates = await readDocument(deps, document.fileKey, document.mime, workspace);

      const filed = await deps.lab.recordCandidates(
        document.patientId,
        document.id,
        candidates,
        document.createdAt,
      );

      await deps.prisma.document.update({
        where: { id: document.id },
        data: { ocrStatus: ProcessingStatus.DONE },
      });

      logger.log(`Read ${filed} candidate result(s) from document ${document.id}`);
    } catch (error) {
      await deps.prisma.document.update({
        where: { id: document.id },
        data: { ocrStatus: ProcessingStatus.FAILED },
      });
      throw error;
    } finally {
      // The workspace holds patient documents in the clear. It goes whether the
      // job succeeded or not.
      await rm(workspace, { recursive: true, force: true });
    }
  };
}

async function readDocument(
  deps: OcrDependencies,
  fileKey: string,
  mime: string,
  workspace: string,
): Promise<LabCandidate[]> {
  const local = join(workspace, 'source');
  await writeFile(local, await download(deps, fileKey));

  const images = mime === 'application/pdf' ? await rasterisePdf(local, workspace) : [local];

  const candidates: LabCandidate[] = [];

  for (const image of images) {
    const page = await deps.engine.recognise(image);
    candidates.push(...parseLabLines(page.lines));
  }

  return candidates;
}

async function download(deps: OcrDependencies, fileKey: string): Promise<Buffer> {
  const stream = await deps.storage.client.getObject(deps.bucket, fileKey);
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks);
}
