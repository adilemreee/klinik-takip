import { Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import { ExportKind, ProcessingStatus, type Prisma } from '@prisma/client';
import type { FileService } from '../files/file.service';
import type { PrismaService } from '../infra/prisma.service';
import type { PermissionsService } from '../authz/permissions.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/templates';
import type { JobHandler } from '../queue/job-runner';
import { PATIENT_COLUMNS, groupsOf, resolveColumns } from './columns';
import type { ExportsService } from './exports.service';
import { MAX_ROWS, type PatientListBuilder, type PatientListFilter } from './patient-list.builder';
import type { PatientSummaryBuilder } from './patient-summary.builder';
import { renderPatientSummary, type PhotoBytes } from './pdf/render';
import { write, type ExportFormat } from './writers';

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

export interface RenderDependencies {
  prisma: PrismaService;
  exports: ExportsService;
  summaries: PatientSummaryBuilder;
  lists: PatientListBuilder;
  files: FileService;
  notifications: NotificationsService;
  permissions: PermissionsService;
  clinicName: string;
}

export function exportRender(deps: RenderDependencies): JobHandler {
  const { prisma, exports, notifications } = deps;
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

        const stored =
          row.kind === ExportKind.PATIENT_SUMMARY
            ? await renderSummary(deps, row, logger)
            : await renderPatientList(deps, row);

        await exports.recordResult(row.id, stored);

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

interface StoredResult {
  fileKey: string;
  mime: string;
  size: number;
  contents: Prisma.InputJsonObject;
}

type ExportRow = { id: string; kind: ExportKind; patientId: string | null; requestedById: string; params: unknown };

async function renderSummary(
  deps: RenderDependencies,
  row: ExportRow,
  logger: Logger,
): Promise<StoredResult> {
  if (!row.patientId) throw new Error('A patient summary needs a patient');

  const params = (row.params ?? {}) as { includePhotos?: boolean };
  const requester = await requesterName(deps.prisma, row.requestedById);

  const summary = await deps.summaries.build(row.patientId, {
    includePhotos: params.includePhotos === true,
    generatedBy: requester,
    clinicName: deps.clinicName,
  });

  const photos = await fetchPhotos(deps.files, summary.photos, logger);
  const pdf = await renderPatientSummary(summary, { photos });

  // Through the sniffing path rather than `store`: it costs nothing and it
  // catches a renderer that ever produced something that is not a PDF.
  const stored = await deps.files.upload(Readable.from(pdf), {
    bucket: 'documents',
    allowedMimeTypes: new Set(['application/pdf']),
    maxBytes: 50 * 1024 * 1024,
    originalName: 'hasta-ozeti.pdf',
  });

  return {
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
      // Spread into a plain object: what was left out and why is the part of
      // the manifest an investigation actually reads.
      omissions: summary.omissions.map((omission) => ({ ...omission })),
    },
  };
}

/**
 * A filtered patient list (spec M12, T6.6).
 *
 * The columns are resolved again here against the requester's *current*
 * permissions. They were checked when the export was asked for, but a job can
 * sit on the queue while somebody's access is revoked, and the file must
 * reflect what they may see when it is written rather than when they clicked.
 */
async function renderPatientList(
  deps: RenderDependencies,
  row: ExportRow,
): Promise<StoredResult> {
  const params = (row.params ?? {}) as {
    format?: ExportFormat;
    columns?: string[];
    filter?: Record<string, string>;
  };

  const requester = await deps.prisma.user.findUniqueOrThrow({
    where: { id: row.requestedById },
    select: { id: true, role: true, staffProfile: { select: { firstName: true, lastName: true } } },
  });

  const held = await deps.permissions.getEffectivePermissions(requester.id, requester.role);
  const columns = resolveColumns(params.columns, held, PATIENT_COLUMNS);

  const filter = parseFilter(params.filter ?? {});
  const actor = { id: requester.id, role: requester.role } as Parameters<
    PatientListBuilder['count']
  >[0];

  const total = await deps.lists.count(actor, filter);
  const format: ExportFormat = params.format === 'XLSX' ? 'XLSX' : 'CSV';

  const truncated = total > MAX_ROWS;
  const name = requester.staffProfile
    ? `${requester.staffProfile.firstName} ${requester.staffProfile.lastName}`.trim()
    : 'Klinik';

  const written = write(format, {
    columns,
    rows: deps.lists.rows(actor, filter, columns),
    // A spreadsheet in a shared folder with no provenance is read as "all our
    // patients". These lines say otherwise, in the file itself.
    provenance: [
      ['Dışa aktaran', name],
      ['Tarih', new Date().toISOString()],
      ['Filtre', describeFilter(params.filter ?? {})],
      ['Satır sayısı', String(Math.min(total, MAX_ROWS))],
      ['Kapsam', 'Yalnız bu kullanıcının görebildiği hastalar'],
      ...(truncated
        ? ([['UYARI', `Sonuç ${MAX_ROWS} satırda kesildi; filtreyi daraltın`]] as [string, string][])
        : []),
    ],
  });

  const stored = await deps.files.store('documents', written.stream, {
    mime: written.mime,
    extension: written.extension,
    maxBytes: 200 * 1024 * 1024,
  });

  return {
    fileKey: stored.key,
    mime: stored.mime,
    size: stored.size,
    contents: {
      format,
      columns: columns.map((column) => column.key),
      groups: groupsOf(columns),
      rows: Math.min(total, MAX_ROWS),
      matched: total,
      // Said in the manifest as well as in the file: a truncated export that
      // looks complete is the one nobody catches.
      truncated,
      filter: params.filter ?? {},
    },
  };
}

function parseFilter(raw: Record<string, string>): PatientListFilter {
  return {
    from: raw.from ? new Date(raw.from) : undefined,
    to: raw.to ? new Date(raw.to) : undefined,
    country: raw.country,
    procedure: raw.procedure,
    assignedDoctorId: raw.assignedDoctorId,
    agencyId: raw.agencyId,
  };
}

function describeFilter(raw: Record<string, string>): string {
  const entries = Object.entries(raw);

  return entries.length === 0
    ? 'yok (tüm kayıtlar)'
    : entries.map(([key, value]) => `${key}=${value}`).join('; ');
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
