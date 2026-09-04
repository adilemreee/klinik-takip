import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import type { DataExportDto } from './dto/portability.dto';

/**
 * A patient's own data, in a form they can take elsewhere (KVKK m.11).
 *
 * The right is to receive the data, not a screenshot of it, so this returns
 * structured JSON rather than a rendered document — the patient summary PDF
 * already exists for reading, and a PDF is not portable in the sense the law
 * means.
 *
 * Two boundaries are deliberate:
 *
 *   - **Only their own.** The caller's file is resolved from the token, so
 *     there is no id to tamper with.
 *   - **Only what is theirs.** A clinician's private note about a patient is
 *     the clinician's professional record; internal triage scores and staff
 *     assignments are the clinic's operational data. Neither is withheld to be
 *     unhelpful — including them would hand over other people's data under the
 *     heading of the patient's own.
 */
@Injectable()
export class PortabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async exportFor(patientId: string): Promise<DataExportDto> {
    const patient = await this.prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
      select: {
        id: true,
        mrn: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        sex: true,
        country: true,
        city: true,
        nationality: true,
        preferredLanguage: true,
        status: true,
        createdAt: true,
      },
    });

    const [
      medicalProfile,
      measurements,
      documents,
      labResults,
      photos,
      appointments,
      medications,
      complications,
      consents,
      surveyResponses,
    ] = await Promise.all([
      this.prisma.medicalProfile.findUnique({
        where: { patientId },
        select: {
          bloodType: true,
          allergies: true,
          chronicConditions: true,
          currentMedications: true,
          smoking: true,
          alcohol: true,
          updatedAt: true,
        },
      }),
      this.prisma.measurement.findMany({
        where: { patientId },
        select: { type: true, value: true, secondaryValue: true, unit: true, measuredAt: true, source: true },
        orderBy: { measuredAt: 'asc' },
      }),
      this.prisma.document.findMany({
        where: { patientId, deletedAt: null },
        select: { type: true, originalName: true, mime: true, size: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      // Confirmed only. An unreviewed OCR reading is not a lab result, and
      // handing one over as if it were is the failure the review step exists
      // to prevent.
      this.prisma.labResult.findMany({
        where: { patientId, verifiedAt: { not: null } },
        select: {
          analyteCode: true,
          analyteName: true,
          value: true,
          unit: true,
          refLow: true,
          refHigh: true,
          flag: true,
          measuredAt: true,
        },
        orderBy: { measuredAt: 'asc' },
      }),
      this.prisma.photo.findMany({
        where: { patientId, deletedAt: null },
        select: { category: true, bodyArea: true, phaseLabel: true, takenAt: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.appointment.findMany({
        where: { patientId },
        select: { type: true, status: true, scheduledAt: true, durationMinutes: true, location: true },
        orderBy: { scheduledAt: 'asc' },
      }),
      this.prisma.medication.findMany({
        where: { patientId },
        select: {
          drugName: true,
          dose: true,
          form: true,
          frequencyRule: true,
          startDate: true,
          endDate: true,
          instructions: true,
          source: true,
        },
        orderBy: { startDate: 'asc' },
      }),
      this.prisma.complication.findMany({
        where: { patientId },
        select: { note: true, bodyArea: true, status: true, reportedAt: true, resolvedAt: true },
        orderBy: { reportedAt: 'asc' },
      }),
      this.prisma.consent.findMany({
        where: { patientId },
        select: { type: true, version: true, signedAt: true, revokedAt: true },
        orderBy: { signedAt: 'asc' },
      }),
      this.prisma.promResponse.findMany({
        where: { patientId },
        select: { answers: true, painScore: true, npsScore: true, milestoneLabel: true, submittedAt: true },
        orderBy: { submittedAt: 'asc' },
      }),
    ]);

    return {
      // Named and dated, because a file with no provenance is hard to use and
      // impossible to check.
      exportedAt: new Date().toISOString(),
      format: 'klinik-portability-1',
      patient,
      medicalProfile,
      measurements,
      documents,
      labResults,
      photos,
      appointments,
      medications,
      complications,
      consents,
      surveyResponses,
      // Said in the file rather than only in a covering note, because the file
      // is what outlives the conversation.
      notIncluded: [
        'Klinik personelinin mesleki notlari',
        'Klinik ici triyaj puanlari ve is akisi verileri',
        'Belge ve fotograflarin kendisi — bunlar uygulamadan tek tek indirilir',
      ],
    };
  }
}
