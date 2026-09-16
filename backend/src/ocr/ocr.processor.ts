import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import type { LabReader, ReportPage } from '../lab/lab-reader.service';
import type { DocumentClassifier } from '../documents/document-classifier.service';
import type { OcrEngine } from './ocr-engine';
import { rasterisePdf } from './pdf-raster';

/** Types worth reading. A passport or an invoice has no lab values on it. */
const OCR_TYPES = new Set(['LAB', 'REPORT', 'ECG', 'IMAGING']);

export interface OcrDependencies {
  prisma: PrismaService;
  files: FileService;
  storage: StorageService;
  lab: LabService;
  reader: LabReader;
  classifier: DocumentClassifier;
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

    // One rasterisation for both questions: what this document is, and what
    // it says. A PDF at 300dpi is expensive enough that doing it twice is
    // worth avoiding.
    const workspace = await mkdtemp(join(tmpdir(), 'klinik-ocr-'));

    try {
      const pages = await pagesOf(deps, document.fileKey, document.mime, workspace);

      /*
       * What kind of document this is, decided by looking at it.
       *
       * Before the type check, because the type is what the check reads. Every
       * upload screen used to begin by asking which of eight kinds the file
       * was, and a lab report filed as OTHER is a lab report whose values are
       * never read — the answer decided the pipeline, and the person least
       * able to give it was the patient holding the phone.
       *
       * Null when the model is off or unsure, and then whatever the uploader
       * said stands.
       */
      let type = document.type;

      try {
        const detected = await deps.classifier.classify(pages, document.patientId);

        if (detected !== null && detected !== document.type) {
          await deps.prisma.document.update({
            where: { id: document.id },
            data: { type: detected },
          });
          logger.log(`Document ${document.id} filed as ${detected} (was ${document.type})`);
          type = detected;
        }
      } catch (error) {
        logger.warn(`Could not classify document ${document.id}: ${String(error)}`);
      }

      if (!OCR_TYPES.has(type)) {
        // A passport has no lab values on it. Skipped is the honest state —
        // not done, which would suggest something was read.
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

      /*
       * The model looks at the page first, and OCR is what happens when it
       * cannot.
       *
       * This order is the whole point. Tesseract transcribes a printed lab
       * table well enough to prove a number is there and badly enough that
       * nothing can be filed on its word, so everything it produced waited for
       * somebody to retype it — and nobody did. A model that can see the page
       * reads the columns, and what it reports is filed.
       */
      const read = await deps.reader.read(pages, document.patientId);

      let filed: number;

      if (read !== null && read.length > 0) {
        filed = await deps.lab.recordRead(
          document.patientId,
          document.id,
          read,
          document.createdAt,
        );
        logger.log(`Model read ${filed} result(s) from document ${document.id}`);
      } else {
        const candidates = await transcribe(deps, pages);

        filed = await deps.lab.recordCandidates(
          document.patientId,
          document.id,
          candidates,
          document.createdAt,
        );
        logger.log(
          `Model unavailable for document ${document.id}; OCR filed ${filed} candidate(s) for review`,
        );
      }

      await deps.prisma.document.update({
        where: { id: document.id },
        data: { ocrStatus: ProcessingStatus.DONE },
      });

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

/** A page, with the file it was written to so the engine can reread it. */
interface LocalPage extends ReportPage {
  path: string;
}

/** The document as page images, whatever it arrived as. */
async function pagesOf(
  deps: OcrDependencies,
  fileKey: string,
  mime: string,
  workspace: string,
): Promise<LocalPage[]> {
  const local = join(workspace, 'source');
  await writeFile(local, await download(deps, fileKey));

  const paths = mime === 'application/pdf' ? await rasterisePdf(local, workspace) : [local];

  return Promise.all(
    paths.map(async (path) => ({
      // A rasterised page is a PNG; anything else arrived as its own image.
      mediaType: mime === 'application/pdf' ? 'image/png' : mime,
      bytes: await readFile(path),
      path,
    })),
  );
}

/** What the engine makes of the same pages, when the model could not read them. */
async function transcribe(deps: OcrDependencies, pages: LocalPage[]): Promise<LabCandidate[]> {
  const candidates: LabCandidate[] = [];

  for (const page of pages) {
    const recognised = await deps.engine.recognise(page.path);
    candidates.push(...parseLabLines(recognised.lines));
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
