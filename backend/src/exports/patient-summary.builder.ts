import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { summarise } from '../medications/adherence';
import { describe as describeRule, parseRule } from '../medications/recurrence';
import { assemble, type PatientSummary, type SummaryInput } from './summary';

/**
 * Reading everything a patient summary needs out of the database (spec M12).
 *
 * Separate from `summary.ts` so the decisions — what is left out and why — stay
 * testable without a database, and separate from the renderer so the drawing
 * never has to reach for a row it forgot to fetch.
 */

/** Enough of a trend to be worth a chart; more than a page can carry. */
const MEASUREMENT_LIMIT = 200;
const LAB_LIMIT = 200;

@Injectable()
export class PatientSummaryBuilder {
  constructor(private readonly prisma: PrismaService) {}

  async build(
    patientId: string,
    options: { includePhotos: boolean; generatedBy: string; clinicName: string },
    now = new Date(),
  ): Promise<PatientSummary> {
    const patient = await this.prisma.patient.findFirstOrThrow({
      where: { id: patientId, deletedAt: null },
    });

    const [surgeries, measurements, labs, medications, photos, aiReports] = await Promise.all([
      this.prisma.surgery.findMany({
        where: { patientId },
        orderBy: { performedAt: 'desc' },
        include: { patient: false },
      }),
      this.prisma.measurement.findMany({
        where: { patientId },
        orderBy: { measuredAt: 'desc' },
        take: MEASUREMENT_LIMIT,
      }),
      this.prisma.labResult.findMany({
        where: { patientId },
        orderBy: { measuredAt: 'desc' },
        take: LAB_LIMIT,
      }),
      this.prisma.medication.findMany({
        where: { patientId, approvedAt: { not: null } },
        include: { logs: true },
        orderBy: { startDate: 'desc' },
      }),
      this.prisma.photo.findMany({
        where: { patientId },
        include: { consent: { select: { revokedAt: true } } },
        orderBy: { takenAt: 'asc' },
      }),
      this.prisma.aiReport.findMany({
        where: { patientId },
        orderBy: { generatedAt: 'desc' },
      }),
    ]);

    const surgeonNames = await this.surgeonNames(surgeries.map((s) => s.surgeonId));
    const reviewerNames = await this.reviewerNames(aiReports.map((r) => r.reviewedById));

    const input: SummaryInput = {
      patient: {
        mrn: patient.mrn,
        firstName: patient.firstName,
        lastName: patient.lastName,
        birthDate: patient.birthDate,
        sex: patient.sex,
        country: patient.country,
        city: patient.city,
        preferredLanguage: patient.preferredLanguage,
      },
      surgeries: surgeries.map((surgery) => ({
        procedureName: surgery.procedureName,
        performedAt: surgery.performedAt,
        surgeon: surgery.surgeonId ? (surgeonNames.get(surgery.surgeonId) ?? null) : null,
        location: surgery.location,
      })),
      measurements: measurements.map((measurement) => ({
        type: measurement.type,
        value: measurement.value.toNumber(),
        secondaryValue: measurement.secondaryValue?.toNumber() ?? null,
        unit: measurement.unit,
        measuredAt: measurement.measuredAt,
      })),
      labs: labs.map((lab) => ({
        analyteName: lab.analyteName,
        value: lab.value.toNumber(),
        unit: lab.unit,
        refLow: lab.refLow?.toNumber() ?? null,
        refHigh: lab.refHigh?.toNumber() ?? null,
        flag: lab.flag,
        measuredAt: lab.measuredAt,
        verifiedAt: lab.verifiedAt,
      })),
      medications: medications.map((medication) => {
        const adherence = summarise(medication.logs, now, medication.timezone);

        return {
          drugName: medication.drugName,
          dose: medication.dose,
          schedule: this.readableSchedule(medication.frequencyRule),
          startDate: medication.startDate,
          stoppedAt: medication.stoppedAt,
          // Null rather than nought: a course with nothing due yet has no
          // score, and a zero would tell the reader the patient is failing.
          adherencePercent:
            adherence.score === null ? null : Math.round(adherence.score * 100),
        };
      }),
      photos: photos.map((photo) => ({
        id: photo.id,
        fileKey: photo.fileKey,
        category: photo.category,
        phaseLabel: photo.phaseLabel,
        takenAt: photo.takenAt,
        // Consent has to be linked *and* unrevoked. A photo with no consent
        // row is clinical-use only (spec M7).
        hasLiveConsent: photo.consentId !== null && photo.consent?.revokedAt === null,
      })),
      aiReports: aiReports.map((report) => ({
        source: report.source,
        contentMd: report.contentMd,
        model: report.model,
        generatedAt: report.generatedAt,
        reviewedAt: report.reviewedAt,
        reviewerName: report.reviewedById
          ? (reviewerNames.get(report.reviewedById) ?? null)
          : null,
      })),
      options: { includePhotos: options.includePhotos },
      generatedAt: now,
      generatedBy: options.generatedBy,
      clinicName: options.clinicName,
    };

    return assemble(input);
  }

  /**
   * The rule as a sentence.
   *
   * A rule nobody can parse is printed as it was written rather than dropped:
   * the reader can still see what was prescribed.
   */
  private readableSchedule(rule: string): string {
    try {
      return describeRule(parseRule(rule));
    } catch {
      return rule;
    }
  }

  private async surgeonNames(ids: (string | null)[]): Promise<Map<string, string>> {
    return this.staffNames(ids);
  }

  private async reviewerNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const present = ids.filter((id): id is string => id !== null);
    if (present.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: present } },
      select: { id: true, staffProfile: { select: { firstName: true, lastName: true } } },
    });

    return new Map(
      users
        .filter((user) => user.staffProfile !== null)
        .map((user) => [
          user.id,
          `${user.staffProfile!.firstName} ${user.staffProfile!.lastName}`.trim(),
        ]),
    );
  }

  private async staffNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const present = ids.filter((id): id is string => id !== null);
    if (present.length === 0) return new Map();

    const profiles = await this.prisma.staffProfile.findMany({
      where: { id: { in: present } },
      select: { id: true, firstName: true, lastName: true },
    });

    return new Map(
      profiles.map((profile) => [profile.id, `${profile.firstName} ${profile.lastName}`.trim()]),
    );
  }
}
