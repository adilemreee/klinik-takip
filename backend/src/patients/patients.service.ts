import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, Patient, Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { PrismaService } from '../infra/prisma.service';
import { generateMrn } from './mrn';
import { VersionConflictException } from './version-conflict';
import {
  AssignStaffDto,
  CreatePatientDto,
  MedicalProfileDto,
  SearchPatientsDto,
  UpdatePatientDto,
} from './dto/patient.dto';

const DEFAULT_LIMIT = 25;
const MRN_ATTEMPTS = 5;

export interface PatientPage {
  items: Patient[];
  nextCursor: string | null;
}

export interface AssignmentSummary {
  id: string;
  role: Role;
  assignedAt: Date;
  staff: { id: string; firstName: string; lastName: string; title: string | null };
}

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

@Injectable()
export class PatientsService {
  private readonly logger = new Logger(PatientsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly audit: AuditService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreatePatientDto,
    context: RequestContext = {},
  ): Promise<Patient> {
    for (let attempt = 0; attempt < MRN_ATTEMPTS; attempt += 1) {
      const mrn = generateMrn();

      try {
        return await this.prisma.$transaction(async (tx) => {
          const patient = await tx.patient.create({
            data: {
              mrn,
              firstName: dto.firstName.trim(),
              lastName: dto.lastName.trim(),
              birthDate: dto.birthDate,
              sex: dto.sex,
              country: dto.country.toUpperCase(),
              city: dto.city,
              nationality: dto.nationality,
              preferredLanguage: dto.preferredLanguage ?? 'tr',
              referralSource: dto.referralSource,
              assignedDoctorId: dto.assignedDoctorId,
              agencyId: dto.agencyId,
            },
          });

          // Inside the transaction: a created patient with no audit record, or
          // a record of a patient that was not created, are both worse than a
          // failed request (spec section 13).
          await this.audit.recordInTransaction(tx, {
            actorId: user.id,
            actorRole: user.role,
            action: AuditAction.CREATE,
            entityType: 'patients',
            entityId: patient.id,
            patientId: patient.id,
            after: patient,
            ...context,
          });

          return patient;
        });
      } catch (error) {
        // File numbers are random, so a collision is possible but rare; retry
        // rather than surfacing it.
        if (this.isUniqueViolation(error, 'mrn')) {
          this.logger.warn(`MRN collision on ${mrn}, retrying`);
          continue;
        }

        throw error;
      }
    }

    throw new ConflictException('Could not allocate a file number');
  }

  /** Throws NotFound when the patient exists but is out of the caller's scope. */
  async findOne(user: AuthenticatedUser, id: string): Promise<Patient> {
    const scope = await this.access.scopeFilter(user);

    const patient = await this.prisma.patient.findFirst({
      where: { AND: [{ id }, scope] },
      include: {
        medicalProfile: true,
        assignedDoctor: { select: { id: true, firstName: true, lastName: true, title: true } },
        surgeries: { orderBy: { performedAt: 'desc' }, take: 5 },
      },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    return patient;
  }

  /**
   * Scoped search.
   *
   * The caller's scope is composed into the query rather than applied to the
   * results: filtering after the read is what eventually leaks through a
   * forgotten count or a paginated edge case.
   */
  async search(user: AuthenticatedUser, dto: SearchPatientsDto): Promise<PatientPage> {
    const scope = await this.access.scopeFilter(user);
    const limit = dto.limit ?? DEFAULT_LIMIT;

    const filters: Prisma.PatientWhereInput[] = [scope];

    if (dto.q) {
      const term = dto.q.trim();
      // ILIKE '%term%' is served by the trigram GIN indexes; staff search on
      // partial and misspelled names, and in health tourism the spelling on
      // file often differs from what is typed (spec M2).
      filters.push({
        OR: [
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
          { mrn: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    if (dto.status) {
      filters.push({ status: dto.status });
    }

    if (dto.country) {
      filters.push({ country: dto.country.toUpperCase() });
    }

    if (dto.assignedDoctorId) {
      filters.push({ assignedDoctorId: dto.assignedDoctorId });
    }

    if (dto.procedure || dto.surgeryFrom || dto.surgeryTo) {
      filters.push({
        surgeries: {
          some: {
            procedureName: dto.procedure
              ? { contains: dto.procedure, mode: 'insensitive' }
              : undefined,
            performedAt:
              dto.surgeryFrom || dto.surgeryTo
                ? { gte: dto.surgeryFrom, lte: dto.surgeryTo }
                : undefined,
          },
        },
      });
    }

    const rows = await this.prisma.patient.findMany({
      where: { AND: filters },
      // Ids are UUIDv7, so this is newest-first without a second sort key and
      // gives a stable cursor even for rows created in the same millisecond.
      orderBy: { id: 'desc' },
      take: limit + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
  }

  /**
   * @param expectedVersion the version the caller read. Omitted by clients that
   * are editing something they just fetched online; supplied by the offline
   * queue, which may be replaying an edit made hours ago.
   */
  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdatePatientDto,
    context: RequestContext = {},
    expectedVersion?: number,
  ): Promise<Patient> {
    await this.access.assertCanAccess(user, id);

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.patient.findUniqueOrThrow({ where: { id } });

      if (expectedVersion !== undefined && before.version !== expectedVersion) {
        // Refused rather than merged. Two people editing the same allergy list
        // is not something an algorithm should settle (spec M15).
        throw new VersionConflictException('patients', expectedVersion, before.version, before);
      }

      const patient = await tx.patient.update({
        where: { id },
        data: {
          ...dto,
          firstName: dto.firstName?.trim(),
          lastName: dto.lastName?.trim(),
          country: dto.country?.toUpperCase(),
          version: { increment: 1 },
        },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'patients',
        entityId: id,
        patientId: id,
        before,
        after: patient,
        ...context,
      });

      return patient;
    });
  }

  async upsertMedicalProfile(
    user: AuthenticatedUser,
    id: string,
    dto: MedicalProfileDto,
    context: RequestContext = {},
    expectedVersion?: number,
  ): Promise<void> {
    await this.access.assertCanAccess(user, id);

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.medicalProfile.findUnique({ where: { patientId: id } });

      if (expectedVersion !== undefined && before && before.version !== expectedVersion) {
        throw new VersionConflictException(
          'medical_profiles',
          expectedVersion,
          before.version,
          before,
        );
      }

      const profile = await tx.medicalProfile.upsert({
        where: { patientId: id },
        create: { patientId: id, ...dto },
        update: { ...dto, version: { increment: 1 } },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: before ? AuditAction.UPDATE : AuditAction.CREATE,
        entityType: 'medical_profiles',
        entityId: profile.id,
        patientId: id,
        before,
        after: profile,
        ...context,
      });
    });
  }

  async assignStaff(
    user: AuthenticatedUser,
    id: string,
    dto: AssignStaffDto,
    context: RequestContext = {},
  ): Promise<void> {
    await this.access.assertCanAccess(user, id);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.patientAssignment.findFirst({
        where: { patientId: id, staffId: dto.staffId, unassignedAt: null },
      });

      if (existing) {
        return;
      }

      const assignment = await tx.patientAssignment.create({
        data: { patientId: id, staffId: dto.staffId, role: dto.role },
      });

      // Assignment decides who can see this file at all, so it is a security
      // change as much as an operational one.
      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.PERMISSION_CHANGE,
        entityType: 'patient_assignments',
        entityId: assignment.id,
        patientId: id,
        after: assignment,
        ...context,
      });
    });
  }

  async unassignStaff(
    user: AuthenticatedUser,
    id: string,
    staffId: string,
    context: RequestContext = {},
  ): Promise<void> {
    await this.access.assertCanAccess(user, id);

    await this.prisma.$transaction(async (tx) => {
      const assignment = await tx.patientAssignment.findFirst({
        where: { patientId: id, staffId, unassignedAt: null },
      });

      if (!assignment) {
        throw new NotFoundException('Assignment not found');
      }

      const updated = await tx.patientAssignment.update({
        where: { id: assignment.id },
        data: { unassignedAt: new Date() },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.PERMISSION_CHANGE,
        entityType: 'patient_assignments',
        entityId: assignment.id,
        patientId: id,
        before: assignment,
        after: updated,
        ...context,
      });
    });
  }

  async listAssignments(user: AuthenticatedUser, id: string): Promise<AssignmentSummary[]> {
    await this.access.assertCanAccess(user, id);

    const rows = await this.prisma.patientAssignment.findMany({
      where: { patientId: id, unassignedAt: null },
      include: {
        staff: { select: { id: true, firstName: true, lastName: true, title: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      assignedAt: row.assignedAt,
      staff: row.staff,
    }));
  }

  /**
   * Soft delete only.
   *
   * Clinical records have legal retention periods; a patient asking for their
   * data to be removed triggers anonymisation once that period expires, not
   * destruction of the row (spec section 8).
   */
  async softDelete(
    user: AuthenticatedUser,
    id: string,
    context: RequestContext = {},
  ): Promise<void> {
    await this.access.assertCanAccess(user, id);

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.patient.findUniqueOrThrow({ where: { id } });
      const after = await tx.patient.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.DELETE,
        entityType: 'patients',
        entityId: id,
        patientId: id,
        before,
        after,
        ...context,
      });
    });
  }

  private isUniqueViolation(error: unknown, field: string): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }

    const target = error.meta?.target;

    if (Array.isArray(target)) {
      return target.includes(field);
    }

    // Prisma types meta loosely; only a string target is meaningful here, and
    // stringifying anything else would just yield '[object Object]'.
    return typeof target === 'string' && target.includes(field);
  }
}

export { Role };
