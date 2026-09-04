import { Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, MedicationLogStatus, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { PrismaService } from '../infra/prisma.service';

/**
 * Who is signed in, for the app to decide what to show them.
 *
 * The composition root's one question. Without it the client would have to
 * decode the access token to find the role — which works right up until the
 * token format changes, and puts a security decision in a place with no way to
 * verify it.
 */
export interface Identity {
  userId: string;
  role: Role;
  /** For the greeting. Falls back to the account's own e-mail. */
  displayName: string;
  /** The patient file this account *is*, for a patient. Null for staff. */
  patientId: string | null;
  /** Whether this account belongs to the clinic rather than to a patient. */
  isStaff: boolean;
}

export interface PatientHomeSummary {
  patient: {
    id: string;
    mrn: string;
    firstName: string;
    lastName: string;
    preferredLanguage: string;
    status: string;
  };
  nextAppointment: { id: string; scheduledAt: Date; type: string; location: string | null } | null;
  /** Doses scheduled for today that are still waiting. */
  medicationsDueToday: number;
  unreadMessages: number;
  /** Documents the clinic is still waiting for before surgery (spec M17). */
  missingDocuments: number;
}

/**
 * What a patient sees about themselves.
 *
 * Separate from the staff patient endpoints on purpose: those require
 * `patients.read`, which a patient does not hold and should not. Reusing them
 * would have meant widening a permission that exists to keep patients out of
 * each other's files.
 *
 * Scope comes from PatientAccessService, so a caregiver reaches the patient
 * they are linked to — and stops reaching them the moment consent is revoked —
 * without this service knowing the rules.
 */
@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
  ) {}

  /**
   * The signed-in account, with nothing that needs a permission to read.
   *
   * Deliberately open to every authenticated user: it answers "who am I",
   * which is the one thing a client has to know before it can know what it may
   * ask for. It returns nothing about anybody else.
   */
  async identity(user: AuthenticatedUser): Promise<Identity> {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        role: true,
        email: true,
        phone: true,
        staffProfile: { select: { firstName: true, lastName: true } },
        patient: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!row) throw new NotFoundException('Account not found');

    const staffName = row.staffProfile
      ? `${row.staffProfile.firstName} ${row.staffProfile.lastName}`.trim()
      : null;
    const patientName = row.patient
      ? `${row.patient.firstName} ${row.patient.lastName}`.trim()
      : null;

    return {
      userId: row.id,
      role: row.role,
      // An account with neither profile is still nameable; a blank greeting is
      // a screen that looks broken.
      displayName: staffName || patientName || row.email || row.phone || 'Kullanıcı',
      patientId: row.patient?.id ?? null,
      isStaff: row.role !== Role.PATIENT && row.role !== Role.CAREGIVER,
    };
  }

  async summary(user: AuthenticatedUser): Promise<PatientHomeSummary> {
    const scope = await this.access.scopeFilter(user);

    const patient = await this.prisma.patient.findFirst({
      where: scope,
      select: {
        id: true,
        mrn: true,
        firstName: true,
        lastName: true,
        preferredLanguage: true,
        status: true,
      },
    });

    if (!patient) {
      // A signed-in user with no patient file is an account that was created
      // but never linked. Reported as not found rather than an empty summary,
      // so the client shows an explanation instead of a blank home screen.
      throw new NotFoundException('No patient file for this account');
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const [nextAppointment, medicationsDueToday, unreadMessages, missingDocuments] =
      await Promise.all([
        this.prisma.appointment.findFirst({
          where: {
            patientId: patient.id,
            scheduledAt: { gte: new Date() },
            status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.REQUESTED] },
          },
          orderBy: { scheduledAt: 'asc' },
          select: { id: true, scheduledAt: true, type: true, location: true },
        }),

        this.prisma.medicationLog.count({
          where: {
            medication: { patientId: patient.id, stoppedAt: null },
            scheduledAt: { gte: startOfDay, lt: endOfDay },
            status: MedicationLogStatus.PENDING,
          },
        }),

        this.prisma.message.count({
          where: {
            conversation: { patientId: patient.id },
            readAt: null,
            // Messages the patient sent are not unread mail for the patient.
            //
            // Written as an explicit OR because `senderId != user.id` is NULL
            // for a row where senderId is NULL, and SQL treats NULL as "not
            // matched". System and bot messages carry no sender, so a plain
            // inequality silently never counts them — which is precisely the
            // mail a patient most needs to see.
            OR: [{ senderId: null }, { senderId: { not: user.id } }],
          },
        }),

        this.countMissingDocuments(patient.id),
      ]);

    return {
      patient,
      nextAppointment,
      medicationsDueToday,
      unreadMessages,
      missingDocuments,
    };
  }

  /**
   * Mandatory pre-op documents the patient has not uploaded yet (spec M17).
   *
   * Counted rather than listed here: the home screen shows a number and the
   * document screen shows which ones.
   */
  private async countMissingDocuments(patientId: string): Promise<number> {
    const [required, uploaded] = await Promise.all([
      this.prisma.documentRequirement.findMany({
        where: { isMandatory: true },
        select: { documentType: true },
      }),
      this.prisma.document.findMany({
        where: { patientId, deletedAt: null },
        select: { type: true },
        distinct: ['type'],
      }),
    ]);

    const present = new Set(uploaded.map((document) => document.type));

    return required.filter((requirement) => !present.has(requirement.documentType)).length;
  }
}
