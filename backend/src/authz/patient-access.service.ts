import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../infra/prisma.service';

/**
 * Data-level scoping: *which* patients a user may touch, as opposed to *what*
 * they may do (that is PermissionsGuard).
 *
 * The two are separate on purpose. A nurse holds `patients.read` but must still
 * only see the patients assigned to her (spec section 2); a permission check
 * alone would give her the whole clinic.
 */
@Injectable()
export class PatientAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A Prisma filter expressing everything this user may see.
   *
   * List endpoints compose this into their query rather than fetching and
   * filtering afterwards — scoping that happens after the read is scoping that
   * a forgotten `count()` or a paginated edge case will eventually leak past.
   */
  async scopeFilter(user: AuthenticatedUser): Promise<Prisma.PatientWhereInput> {
    const notDeleted: Prisma.PatientWhereInput = { deletedAt: null };

    switch (user.role) {
      case Role.SUPER_ADMIN:
      case Role.DOCTOR:
        return notDeleted;

      case Role.NURSE:
      case Role.COORDINATOR: {
        const profile = await this.prisma.staffProfile.findUnique({
          where: { userId: user.id },
          select: { id: true, canSeeAllPatients: true },
        });

        if (!profile) {
          return this.nothing();
        }

        if (profile.canSeeAllPatients) {
          return notDeleted;
        }

        // Assigned, or the doctor of record.
        return {
          ...notDeleted,
          OR: [
            { assignments: { some: { staffId: profile.id, unassignedAt: null } } },
            { assignedDoctorId: profile.id },
          ],
        };
      }

      case Role.PATIENT:
        return { ...notDeleted, userId: user.id };

      case Role.CAREGIVER:
        // Only while the patient's consent stands (spec section 2).
        return {
          ...notDeleted,
          caregivers: { some: { caregiverUserId: user.id, revokedAt: null } },
        };

      case Role.FINANCE:
      default:
        // Finance has no clinical access at all. Their work goes through the
        // finance module, which joins to patients on its own terms.
        return this.nothing();
    }
  }

  async canAccess(user: AuthenticatedUser, patientId: string): Promise<boolean> {
    const scope = await this.scopeFilter(user);

    const count = await this.prisma.patient.count({
      where: { AND: [{ id: patientId }, scope] },
    });

    return count === 1;
  }

  /**
   * Throws NotFound, not Forbidden.
   *
   * "You may not see this patient" and "no such patient" must be
   * indistinguishable: a 403 confirms the record exists, which lets anyone with
   * an account probe whether a given person is a patient here.
   */
  async assertCanAccess(user: AuthenticatedUser, patientId: string): Promise<void> {
    if (!(await this.canAccess(user, patientId))) {
      throw new NotFoundException('Patient not found');
    }
  }

  /** A filter that matches nothing, without special-casing at every call site. */
  private nothing(): Prisma.PatientWhereInput {
    return { id: { in: [] } };
  }
}
