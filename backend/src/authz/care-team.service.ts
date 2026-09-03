import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { PermissionsService } from './permissions.service';

/**
 * Who is responsible for a patient, resolved to user ids.
 *
 * Extracted because two features now need to wake somebody about one patient —
 * the panic button and an urgently triaged message — and "who is responsible"
 * is exactly the sort of answer that must not have two implementations. The
 * moment they differ, one of them is waking the wrong person and nobody finds
 * out until the night it matters.
 */
export interface CareTeam {
  /** User ids of nurses assigned to this patient. */
  nurses: string[];
  /** User ids of coordinators assigned to this patient. */
  coordinators: string[];
  /** The patient's doctor of record, if they have one. */
  doctorUserId: string | null;
  /**
   * Everyone holding `emergency.receive` — the floor under any escalation, for
   * the patient who has no care team at all and is therefore the patient nobody
   * is watching.
   */
  receivers: string[];
}

export const RECEIVE_PERMISSION = 'emergency.receive';

@Injectable()
export class CareTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async of(patientId: string): Promise<CareTeam> {
    const [patient, assignments, receivers] = await Promise.all([
      this.prisma.patient.findUnique({
        where: { id: patientId },
        select: { assignedDoctor: { select: { userId: true } } },
      }),
      this.prisma.patientAssignment.findMany({
        where: { patientId, unassignedAt: null },
        select: { role: true, staff: { select: { userId: true } } },
      }),
      this.permissions.usersWith(RECEIVE_PERMISSION),
    ]);

    return {
      nurses: assignments.filter((a) => a.role === Role.NURSE).map((a) => a.staff.userId),
      coordinators: assignments
        .filter((a) => a.role === Role.COORDINATOR)
        .map((a) => a.staff.userId),
      doctorUserId: patient?.assignedDoctor?.userId ?? null,
      receivers,
    };
  }

  /**
   * Everyone to tell at once, rather than in rungs.
   *
   * The escalation ladder exists for the panic button, where spacing the alerts
   * out keeps somebody in reserve. An urgent message is not that: it is one
   * notification, and it should reach whoever can act on it now.
   *
   * Falls back to the whole rota when nobody is assigned, which is right for
   * something that cannot wait and wrong for anything that can — see
   * `assigned`.
   */
  async everyone(patientId: string): Promise<string[]> {
    const team = await this.of(patientId);
    const named = namedStaff(team);

    return [...new Set(named.length > 0 ? named : team.receivers)];
  }

  /**
   * Only the people actually responsible for this patient, with no fallback.
   *
   * For anything that is not urgent. A low medication-adherence warning about
   * an unassigned patient, broadcast to every account on the emergency rota,
   * is a daily message to the whole clinic about somebody none of them are
   * looking after — and the clinic learns to mute it, which is a cost paid by
   * the alerts that do matter.
   *
   * An empty answer means the patient has nobody, and the fix for that is to
   * assign somebody rather than to page everybody.
   */
  async assigned(patientId: string): Promise<string[]> {
    return [...new Set(namedStaff(await this.of(patientId)))];
  }
}

function namedStaff(team: CareTeam): string[] {
  return [
    ...team.nurses,
    ...team.coordinators,
    ...(team.doctorUserId ? [team.doctorUserId] : []),
  ];
}
