import { MeasurementType, type LabFlag, type Sex } from '@prisma/client';

/**
 * Deciding what goes into a patient summary, and saying what did not
 * (spec M12, T6.5).
 *
 * This module holds the judgement and none of the drawing, because the
 * judgement is the part that can be wrong in a way nobody notices.
 *
 * One rule runs through all of it: **nothing is omitted silently.** A summary
 * with no photo section reads as a patient with no photographs; a lab table
 * missing the unverified results reads as a complete set of results. Both are
 * false, and a document that leaves the building carrying a false impression is
 * worse than one that carries less.
 *
 * So every exclusion produces an `Omission` with a count and a reason, the
 * renderer prints them, and the same list is stored on the export row — which
 * is what the audit record needs to answer "what did that file contain".
 */

export type OmissionReason =
  /** OCR output a human has not confirmed (spec M16). */
  | 'lab-unverified'
  /** No live photo-usage consent (spec M7). */
  | 'photo-no-consent'
  /** Photographs were not asked for. */
  | 'photo-not-requested'
  /** AI text no clinician has signed off (spec 14.3). */
  | 'ai-unreviewed';

export interface Omission {
  section: string;
  reason: OmissionReason;
  count: number;
}

export interface SummaryPatient {
  mrn: string;
  firstName: string;
  lastName: string;
  birthDate: Date;
  sex: Sex;
  country: string;
  city: string | null;
  preferredLanguage: string;
}

export interface SummarySurgery {
  procedureName: string;
  performedAt: Date;
  surgeon: string | null;
  location: string | null;
}

export interface SummaryMeasurement {
  type: MeasurementType;
  value: number;
  secondaryValue: number | null;
  unit: string;
  measuredAt: Date;
}

export interface SummaryLab {
  analyteName: string;
  value: number;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  flag: LabFlag | null;
  measuredAt: Date;
  verifiedAt: Date | null;
}

export interface SummaryMedication {
  drugName: string;
  dose: string;
  schedule: string;
  startDate: Date;
  stoppedAt: Date | null;
  adherencePercent: number | null;
}

export interface SummaryPhoto {
  id: string;
  fileKey: string;
  category: string;
  phaseLabel: string | null;
  takenAt: Date;
  /** A live, unrevoked photo-usage consent. */
  hasLiveConsent: boolean;
}

export interface SummaryAiReport {
  source: string;
  contentMd: string;
  model: string;
  generatedAt: Date;
  reviewedAt: Date | null;
  reviewerName: string | null;
}

export interface SummaryInput {
  patient: SummaryPatient;
  surgeries: SummarySurgery[];
  measurements: SummaryMeasurement[];
  labs: SummaryLab[];
  medications: SummaryMedication[];
  photos: SummaryPhoto[];
  aiReports: SummaryAiReport[];
  options: { includePhotos: boolean };
  generatedAt: Date;
  generatedBy: string;
  clinicName: string;
}

export interface MeasurementSeries {
  type: MeasurementType;
  unit: string;
  points: { at: Date; value: number }[];
  latest: SummaryMeasurement;
}

export interface PatientSummary {
  patient: SummaryPatient;
  surgeries: SummarySurgery[];
  series: MeasurementSeries[];
  labs: SummaryLab[];
  medications: SummaryMedication[];
  photos: SummaryPhoto[];
  aiReports: SummaryAiReport[];
  omissions: Omission[];
  generatedAt: Date;
  generatedBy: string;
  clinicName: string;
}

/** Newest first, because that is the order a clinician reads them in. */
const byNewest = <T>(at: (item: T) => Date) => (a: T, b: T): number =>
  at(b).getTime() - at(a).getTime();

export function assemble(input: SummaryInput): PatientSummary {
  const omissions: Omission[] = [];

  // Labs: OCR output is not a result until a human has confirmed it, so an
  // unverified value must not appear in a document a doctor will read as fact.
  const verifiedLabs = input.labs.filter((lab) => lab.verifiedAt !== null);
  note(omissions, 'labs', 'lab-unverified', input.labs.length - verifiedLabs.length);

  // AI: text nobody has signed off never enters a permanent document. Approved
  // text does, labelled, with the name of whoever approved it.
  const reviewed = input.aiReports.filter((report) => report.reviewedAt !== null);
  note(omissions, 'ai', 'ai-unreviewed', input.aiReports.length - reviewed.length);

  const photos = selectPhotos(input, omissions);

  return {
    patient: input.patient,
    surgeries: [...input.surgeries].sort(byNewest((surgery) => surgery.performedAt)),
    series: seriesOf(input.measurements),
    labs: [...verifiedLabs].sort(byNewest((lab) => lab.measuredAt)),
    medications: [...input.medications].sort(
      (a, b) => Number(a.stoppedAt !== null) - Number(b.stoppedAt !== null),
    ),
    photos,
    aiReports: [...reviewed].sort(byNewest((report) => report.generatedAt)),
    omissions,
    generatedAt: input.generatedAt,
    generatedBy: input.generatedBy,
    clinicName: input.clinicName,
  };
}

/**
 * Photographs, which are the most sensitive thing an export can carry.
 *
 * Off by default: this file leaves the clinic, and a face is not something a
 * signed URL can take back. When they are asked for, only those with a live
 * photo-usage consent go in — and the ones held back are counted, because a
 * summary with no photo section otherwise reads as a patient who has none.
 */
function selectPhotos(input: SummaryInput, omissions: Omission[]): SummaryPhoto[] {
  if (!input.options.includePhotos) {
    note(omissions, 'photos', 'photo-not-requested', input.photos.length);
    return [];
  }

  const consented = input.photos.filter((photo) => photo.hasLiveConsent);
  note(omissions, 'photos', 'photo-no-consent', input.photos.length - consented.length);

  return [...consented].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
}

function note(
  omissions: Omission[],
  section: string,
  reason: OmissionReason,
  count: number,
): void {
  // Only a real omission is recorded. "0 results left out" on every page is
  // noise, and noise is what stops the real line being read.
  if (count > 0) omissions.push({ section, reason, count });
}

/**
 * One series per measurement type, oldest point first.
 *
 * Blood pressure's second number is deliberately dropped from the chart rather
 * than plotted on the same axis: systolic and diastolic on one line look like
 * one wildly unstable reading. The latest pair is printed in full beside it.
 */
export function seriesOf(measurements: SummaryMeasurement[]): MeasurementSeries[] {
  const byType = new Map<MeasurementType, SummaryMeasurement[]>();

  for (const measurement of measurements) {
    byType.set(measurement.type, [...(byType.get(measurement.type) ?? []), measurement]);
  }

  return [...byType.entries()]
    .map(([type, items]) => {
      const ordered = [...items].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
      const latest = ordered[ordered.length - 1]!;

      return {
        type,
        unit: latest.unit,
        points: ordered.map((item) => ({ at: item.measuredAt, value: item.value })),
        latest,
      };
    })
    .sort((a, b) => a.type.localeCompare(b.type));
}

/** Whether a lab value sits outside its own reference range. */
export function isOutOfRange(lab: SummaryLab): boolean {
  if (lab.refLow !== null && lab.value < lab.refLow) return true;
  if (lab.refHigh !== null && lab.value > lab.refHigh) return true;

  return false;
}

/**
 * The one-line note a reader needs when something was held back.
 *
 * Turkish, because it is printed in a Turkish document; the wording says the
 * reason rather than only the count, so nobody has to guess whether the data
 * is missing or does not exist.
 */
export function describeOmission(omission: Omission): string {
  switch (omission.reason) {
    case 'lab-unverified':
      return `${omission.count} doğrulanmamış laboratuvar sonucu rapora alınmadı (bir klinisyen onaylamadan sonuç sayılmaz).`;
    case 'photo-no-consent':
      return `${omission.count} fotoğraf, geçerli fotoğraf onamı olmadığı için rapora alınmadı.`;
    case 'photo-not-requested':
      return `${omission.count} fotoğraf bu raporda istenmedi.`;
    case 'ai-unreviewed':
      return `${omission.count} yapay zekâ metni, bir hekim onaylamadığı için rapora alınmadı.`;
  }
}
