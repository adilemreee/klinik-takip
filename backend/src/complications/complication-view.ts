import type { Complication, ComplicationStatus } from '@prisma/client';

/**
 * A complication report as the client is told it looks.
 *
 * The Prisma row carries three internal user ids — who reported, who
 * acknowledged, who resolved — and, when it is fetched with its relations, a
 * second copy of the patient and of the photographs that the view already
 * carries beside it. None of that is in `ComplicationDto`, and a row returned
 * where a view was promised typechecks cleanly because the documented fields
 * are a subset of it. So the projection is written out by hand: a field
 * reaches the client because it is named here, not because it exists.
 */
export interface ComplicationSummary {
  id: string;
  patientId: string;
  status: ComplicationStatus;
  note: string;
  bodyArea: string | null;
  reportedAt: Date;
  acknowledgedAt: Date | null;
  firstResponse: string | null;
  resolvedAt: Date | null;
  resolution: string | null;
}

export function complicationView(complication: Complication): ComplicationSummary {
  return {
    id: complication.id,
    patientId: complication.patientId,
    status: complication.status,
    note: complication.note,
    bodyArea: complication.bodyArea,
    reportedAt: complication.reportedAt,
    acknowledgedAt: complication.acknowledgedAt,
    firstResponse: complication.firstResponse,
    resolvedAt: complication.resolvedAt,
    resolution: complication.resolution,
  };
}
