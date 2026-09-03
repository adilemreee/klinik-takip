import { Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import { ExportKind, ProcessingStatus } from '@prisma/client';
import type { FileService } from '../files/file.service';
import type { PrismaService } from '../infra/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/templates';
import type { JobHandler } from '../queue/job-runner';
import type { ExportsService } from './exports.service';
import type { PatientSummaryBuilder } from './patient-summary.builder';
import { renderPatientSummary, type PhotoBytes } from './pdf/render';

/**
 * Rendering a requested export (spec M12, T6.5).
 *
 * Off the request path because a summary with charts and photographs takes
 * seconds, and because the specification asks for it: exports are produced on a
 * queue and a notification says when the file is ready.
 */

/** Bytes a single export will pull out of object storage for photographs. */
const PHOTO_BUDGET_BYTES = 12 * 1024 * 1024;
const MAX_PHOTOS = 12;

export function exportRender(
  prisma: PrismaService,
  exports: ExportsService,
  builder: PatientSummaryBuilder,
  files: FileService,
  notifications: NotificationsService,
  clinicName: string,
): JobHandler {
  const logger = new Logger('ExportRender');

  return async (): Promise<void> => {
    const pending = await prisma.export.findMany({
      where: { status: ProcessingStatus.QUEUED },
      orderBy: { id: 'asc' },
      take: 5,
    });

    for (const row of pending) {
      try {
        await exports.markStarted(row.id);

        if (row.kind !== ExportKind.PATIENT_SUMMARY || !row.patientId) {
          throw new Error(`Unsupported export kind: ${row.kind}`);
        }

        const params = (row.params ?? {}) as { includePhotos?: boolean };
        const requester = await requesterName(prisma, row.requestedById);

        const summary = await builder.build(row.patientId, {
          includePhotos: params.includePhotos === true,
          generatedBy: requester,
          clinicName,
        });

        const photos = await fetchPhotos(files, summary.photos, logger);
        const pdf = await renderPatientSummary(summary, { photos });

        const stored = await files.upload(Readable.from(pdf), {
          bucket: 'documents',
          allowedMimeTypes: new Set(['application/pdf']),
          maxBytes: 50 * 1024 * 1024,
          originalName: 'hasta-ozeti.pdf',
        });

        await exports.recordResult(row.id, {
          fileKey: stored.key,
          mime: stored.mime,
          size: stored.size,
          // The manifest is what makes the audit entry answer "what was in it".
          contents: {
            surgeries: summary.surgeries.length,
            measurementSeries: summary.series.length,
            labs: summary.labs.length,
            medications: summary.medications.length,
            photos: summary.photos.length,
            aiReports: summary.aiReports.length,
            // Spread into a plain object: what was left out and why is the
            // part of the manifest an investigation actually reads.
            omissions: summary.omissions.map((omission) => ({ ...omission })),
          },
        });

        await notifications.dispatch({
          userId: row.requestedById,
          type: NOTIFICATION_TYPES.exportReady,
          data: { exportId: row.id },
        });

        logger.log(`Export ${row.id} rendered (${stored.size} bytes)`);
      } catch (error) {
        // The person who asked has to learn that it failed; a request that
        // sits at QUEUED forever is the worst of both.
        logger.error(`Export ${row.id} failed: ${String(error)}`);
        await exports.recordFailure(row.id, messageOf(error));
      }
    }
  };
}

/** Deletes the objects of exports past their expiry (spec M12, section 8). */
export function exportSweep(exports: ExportsService): JobHandler {
  return async (): Promise<void> => {
    await exports.sweepExpired();
  };
}

async function requesterName(prisma: PrismaService, userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { staffProfile: { select: { firstName: true, lastName: true } } },
  });

  if (!user?.staffProfile) return 'Klinik';

  return `${user.staffProfile.firstName} ${user.staffProfile.lastName}`.trim();
}

/**
 * Pulls the photographs the summary decided to include.
 *
 * Bounded in both count and bytes: a patient with two hundred photographs would
 * otherwise produce a document nobody can open, from a worker holding all of it
 * in memory. What is left out is already recorded in the summary's manifest.
 */
async function fetchPhotos(
  files: FileService,
  photos: { id: string; fileKey: string; phaseLabel: string | null; takenAt: Date }[],
  logger: Logger,
): Promise<PhotoBytes[]> {
  const fetched: PhotoBytes[] = [];
  let budget = PHOTO_BUDGET_BYTES;

  for (const photo of photos.slice(0, MAX_PHOTOS)) {
    try {
      const stat = await files.stat('photos', photo.fileKey);
      if (stat.size > budget) break;

      const data = await files.read('photos', photo.fileKey);
      budget -= data.length;

      fetched.push({
        id: photo.id,
        data,
        caption: `${photo.phaseLabel ?? ''} ${photo.takenAt.toISOString().slice(0, 10)}`.trim(),
      });
    } catch (error) {
      // A missing object must not fail the whole report; the rest of the
      // summary is still worth having.
      logger.warn(`Photo ${photo.id} could not be read: ${String(error)}`);
    }
  }

  return fetched;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
