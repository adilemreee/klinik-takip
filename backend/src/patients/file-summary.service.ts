import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AppointmentStatus,
  ComplicationStatus,
  LabFlag,
  MedicationLogStatus,
  MilestoneStatus,
  ProcessingStatus,
  Role,
} from '@prisma/client';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { PrismaService } from '../infra/prisma.service';
import { summarise, type Adherence } from '../medications/adherence';

/**
 * What the specification calls the doctor's single-screen patient summary:
 * "son ölçümler, açık uyarılar, son mesaj, yaklaşan kontrol, ilaç uyumu
 * yüzdesi" (M2).
 *
 * One endpoint rather than nine, because the alternative is nine round trips
 * before a file can be drawn — and because the counts on the file's sections
 * ("2 tahlil bekliyor") have to agree with each other. Composed here, they
 * come from one read of the record.
 */
export interface PatientFileSummary {
  patient: {
    id: string;
    mrn: string;
    firstName: string;
    lastName: string;
    birthDate: Date;
    /** Computed here so two clients cannot disagree about it. */
    age: number;
    sex: string;
    country: string;
    city: string | null;
    nationality: string | null;
    preferredLanguage: string;
    referralSource: string | null;
    status: string;
    createdAt: Date;
    version: number;
  };
  contact: { email: string | null; phone: string | null };
  medicalProfile: MedicalProfileView | null;
  lastSurgery: SurgeryView | null;
  /** Who may see this file, which is who is responsible for it. */
  assignments: { staffId: string; name: string; title: string | null; role: Role }[];
  /** The newest reading of each kind the clinic tracks. */
  latestMeasurements: MeasurementView[];
  alerts: {
    criticalLabs: number;
    labsAwaitingReview: number;
    openComplications: number;
    openEmergency: boolean;
    processingDocuments: number;
    unreviewedReports: number;
  };
  lastMessage: { body: string | null; sentAt: Date; fromPatient: boolean } | null;
  unreadMessages: number;
  nextAppointment: { id: string; scheduledAt: Date; type: string; status: string } | null;
  nextFollowUp: { id: string; label: string; dueAt: Date; status: string } | null;
  /** Null when nothing has been prescribed, which is not the same as zero. */
  adherence: (Adherence & { activeMedications: number }) | null;
  counts: { documents: number; photos: number; labResults: number; appointments: number };
}

export interface MedicalProfileView {
  bloodType: string | null;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  smoking: boolean | null;
  alcohol: boolean | null;
  targetWeightKg: string | null;
  notes: string | null;
  updatedAt: Date;
  version: number;
}

export interface SurgeryView {
  id: string;
  procedureName: string;
  performedAt: Date;
  /** Whole days since, for "14 gün önce" without the client doing date maths. */
  daysAgo: number;
  location: string | null;
  surgeonName: string | null;
}

export interface MeasurementView {
  type: string;
  value: string;
  secondaryValue: string | null;
  unit: string;
  measuredAt: Date;
  source: string;
}

@Injectable()
export class PatientFileSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
  ) {}

  async summary(user: AuthenticatedUser, patientId: string): Promise<PatientFileSummary> {
    await this.access.assertCanAccess(user, patientId);

    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      include: {
        medicalProfile: true,
        user: { select: { email: true, phone: true } },
        surgeries: { orderBy: { performedAt: 'desc' }, take: 1 },
        assignments: {
          where: { unassignedAt: null },
          include: { staff: { select: { id: true, firstName: true, lastName: true, title: true } } },
        },
      },
    });

    if (!patient) throw new NotFoundException('Patient not found');

    const now = new Date();

    // Everything below is independent of everything else, so it goes out at
    // once rather than in sequence: a file summary that takes nine round trips
    // to compose is a file that opens slowly on hotel wifi.
    const [
      measurements,
      criticalLabs,
      labsAwaitingReview,
      openComplications,
      openEmergency,
      processingDocuments,
      unreviewedReports,
      conversation,
      nextAppointment,
      nextFollowUp,
      medications,
      documents,
      photos,
      labResults,
      appointments,
    ] = await Promise.all([
      this.latestMeasurements(patientId),
      this.prisma.labResult.count({
        where: { patientId, flag: LabFlag.CRITICAL, verifiedAt: { not: null } },
      }),
      this.prisma.labResult.count({ where: { patientId, verifiedAt: null } }),
      this.prisma.complication.count({
        where: { patientId, status: { in: [ComplicationStatus.REPORTED, ComplicationStatus.ACKNOWLEDGED] } },
      }),
      this.prisma.emergencyEvent.count({
        where: { patientId, status: { in: ['TRIGGERED', 'ACKNOWLEDGED'] } },
      }),
      this.prisma.document.count({
        where: {
          patientId,
          deletedAt: null,
          ocrStatus: { in: [ProcessingStatus.PENDING, ProcessingStatus.PROCESSING] },
        },
      }),
      this.prisma.aiReport.count({ where: { patientId, reviewedAt: null } }),
      this.conversation(patientId, user.id),
      this.prisma.appointment.findFirst({
        where: {
          patientId,
          scheduledAt: { gte: now },
          status: { in: [AppointmentStatus.REQUESTED, AppointmentStatus.CONFIRMED] },
        },
        orderBy: { scheduledAt: 'asc' },
        select: { id: true, scheduledAt: true, type: true, status: true },
      }),
      this.prisma.followUpMilestone.findFirst({
        where: {
          schedule: { patientId },
          status: { in: [MilestoneStatus.PENDING, MilestoneStatus.NOTIFIED] },
        },
        orderBy: { dueAt: 'asc' },
        select: { id: true, label: true, dueAt: true, status: true },
      }),
      // "Active" is a course nobody has stopped. An end date in the past is
      // still active for adherence: the doses it produced were real.
      this.prisma.medication.findMany({
        where: { patientId, stoppedAt: null },
        select: {
          id: true,
          timezone: true,
          logs: { select: { scheduledAt: true, takenAt: true, status: true } },
        },
      }),
      this.prisma.document.count({ where: { patientId, deletedAt: null } }),
      this.prisma.photo.count({ where: { patientId, deletedAt: null } }),
      this.prisma.labResult.count({ where: { patientId } }),
      this.prisma.appointment.count({ where: { patientId } }),
    ]);

    const surgery = patient.surgeries[0] ?? null;
    const surgeon = surgery?.surgeonId ? await this.surgeonName(surgery.surgeonId) : null;

    return {
      patient: {
        id: patient.id,
        mrn: patient.mrn,
        firstName: patient.firstName,
        lastName: patient.lastName,
        birthDate: patient.birthDate,
        age: ageOn(patient.birthDate, now),
        sex: patient.sex,
        country: patient.country,
        city: patient.city,
        nationality: patient.nationality,
        preferredLanguage: patient.preferredLanguage,
        referralSource: patient.referralSource,
        status: patient.status,
        createdAt: patient.createdAt,
        version: patient.version,
      },
      contact: { email: patient.user?.email ?? null, phone: patient.user?.phone ?? null },
      medicalProfile: patient.medicalProfile
        ? {
            bloodType: patient.medicalProfile.bloodType,
            allergies: patient.medicalProfile.allergies,
            chronicConditions: patient.medicalProfile.chronicConditions,
            currentMedications: patient.medicalProfile.currentMedications,
            smoking: patient.medicalProfile.smoking,
            alcohol: patient.medicalProfile.alcohol,
            targetWeightKg: patient.medicalProfile.targetWeightKg?.toString() ?? null,
            notes: patient.medicalProfile.notes,
            updatedAt: patient.medicalProfile.updatedAt,
            version: patient.medicalProfile.version,
          }
        : null,
      lastSurgery: surgery
        ? {
            id: surgery.id,
            procedureName: surgery.procedureName,
            performedAt: surgery.performedAt,
            daysAgo: wholeDaysBetween(surgery.performedAt, now),
            location: surgery.location,
            surgeonName: surgeon,
          }
        : null,
      assignments: patient.assignments.map((assignment) => ({
        staffId: assignment.staff.id,
        name: `${assignment.staff.firstName} ${assignment.staff.lastName}`,
        title: assignment.staff.title,
        role: assignment.role,
      })),
      latestMeasurements: measurements,
      alerts: {
        criticalLabs,
        labsAwaitingReview,
        openComplications,
        openEmergency: openEmergency > 0,
        processingDocuments,
        unreviewedReports,
      },
      lastMessage: conversation.lastMessage,
      unreadMessages: conversation.unread,
      nextAppointment,
      nextFollowUp,
      adherence: adherenceOf(medications, now),
      counts: { documents, photos, labResults, appointments },
    };
  }

  /**
   * One row per measurement type, newest first.
   *
   * `distinct` on an ordered query is Prisma's way of saying "the first of each
   * group"; the alternative is one query per type, which is eight round trips
   * to fill a card.
   */
  private async latestMeasurements(patientId: string): Promise<MeasurementView[]> {
    const rows = await this.prisma.measurement.findMany({
      where: { patientId },
      orderBy: [{ type: 'asc' }, { measuredAt: 'desc' }],
      distinct: ['type'],
      select: {
        type: true,
        value: true,
        secondaryValue: true,
        unit: true,
        measuredAt: true,
        source: true,
      },
    });

    return rows.map((row) => ({
      type: row.type,
      value: row.value.toString(),
      secondaryValue: row.secondaryValue?.toString() ?? null,
      unit: row.unit,
      measuredAt: row.measuredAt,
      source: row.source,
    }));
  }

  /** The last thing said, and how much of it this reader has not seen. */
  private async conversation(
    patientId: string,
    userId: string,
  ): Promise<{
    lastMessage: { body: string | null; sentAt: Date; fromPatient: boolean } | null;
    unread: number;
  }> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { patientId },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        patient: { select: { userId: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, createdAt: true, senderId: true },
        },
        participants: { where: { userId }, select: { lastReadAt: true } },
      },
    });

    if (!conversation) return { lastMessage: null, unread: 0 };

    const message = conversation.messages[0] ?? null;
    const lastReadAt = conversation.participants[0]?.lastReadAt ?? null;

    const unread = await this.prisma.message.count({
      where: {
        conversationId: conversation.id,
        senderId: { not: userId },
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
      },
    });

    return {
      lastMessage: message
        ? {
            body: message.body,
            sentAt: message.createdAt,
            fromPatient: message.senderId === conversation.patient.userId,
          }
        : null,
      unread,
    };
  }

  private async surgeonName(surgeonId: string): Promise<string | null> {
    const staff = await this.prisma.staffProfile.findFirst({
      where: { id: surgeonId },
      select: { firstName: true, lastName: true, title: true },
    });

    if (!staff) return null;

    return [staff.title, staff.firstName, staff.lastName].filter(Boolean).join(' ');
  }
}

/**
 * One score across every active course.
 *
 * The patient's own timezone decides what "today" means; taking the first
 * course's is right because a patient has one, and defaulting to the server's
 * would score an 8 p.m. dose in Istanbul against a London midnight.
 */
function adherenceOf(
  medications: { timezone: string; logs: { scheduledAt: Date; takenAt: Date | null; status: MedicationLogStatus }[] }[],
  now: Date,
): (Adherence & { activeMedications: number }) | null {
  const first = medications[0];
  if (!first) return null;

  return {
    ...summarise(
      medications.flatMap((medication) => medication.logs),
      now,
      first.timezone,
    ),
    activeMedications: medications.length,
  };
}

/** Whole years, counting the birthday rather than dividing by 365.25. */
export function ageOn(birthDate: Date, on: Date): number {
  let age = on.getUTCFullYear() - birthDate.getUTCFullYear();
  const month = on.getUTCMonth() - birthDate.getUTCMonth();

  if (month < 0 || (month === 0 && on.getUTCDate() < birthDate.getUTCDate())) age -= 1;

  return Math.max(0, age);
}

export function wholeDaysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}
