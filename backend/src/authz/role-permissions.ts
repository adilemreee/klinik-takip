import { Role } from '@prisma/client';

/**
 * What each role may do, written down rather than stored.
 *
 * This used to be three tables — 42 permissions, 113 role rows and a per-user
 * override table — seeded on deploy, cached in Redis and invalidated by hand.
 * That shape is for an organisation that hires people into varied jobs and
 * changes what they may do without shipping code. A clinic with a handful of
 * staff is not that: nobody had ever written a per-user override, and the
 * matrix was a fixture pretending to be configuration.
 *
 * So the permissions stay — every endpoint still declares what it needs, and
 * that is what is enforced — and the matrix becomes a constant. What may
 * happen is now answerable by reading one file.
 *
 * Three roles, and the collapse from seven is not lossless:
 *
 *   - There is no clinical role below DOCTOR any more. What NURSE could do —
 *     write medical notes, upload photographs — needs DOCTOR now. A clinic
 *     that employs one gives them that role and accepts that it carries more.
 *   - FINANCE is gone; its four permissions sit with DOCTOR, and the finance
 *     screens left the app in the same change.
 *   - CAREGIVER is gone. It had two permissions and no rows in the link table
 *     it depended on, so nothing had ever used it.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<string>>> = {
  /**
   * The clinic, as far as the record is concerned: everything clinical, and
   * everything that used to need an administrator.
   *
   * The four `self.*` permissions are deliberately absent. They are how a
   * patient reaches their own record through `/me`, and a clinician has no
   * patient record to reach.
   */
  [Role.DOCTOR]: new Set([
    'ai.protocols.manage',
    'ai.review',
    'analytics.read',
    'appointments.read',
    'appointments.write',
    'audit.read',
    'consents.collect',
    'consents.read',
    'documents.read',
    'documents.write',
    'emergency.receive',
    'emergency.resolve',
    'export.create',
    'finance.read',
    'finance.report',
    'finance.write',
    'labs.verify',
    'medical.decide',
    'medical.read',
    'medical.write',
    'medications.approve',
    'medications.prescribe',
    'medications.read',
    'messages.clinical',
    'messages.read',
    'messages.window.manage',
    'messages.write',
    'patients.assign',
    'patients.delete',
    'patients.read',
    'patients.read.all',
    'patients.write',
    'permissions.manage',
    'photos.read',
    'photos.write',
    'staff.manage',
    'staff.read',
    'surgeries.write',
  ]),

  /**
   * Everything around the treatment and nothing clinical.
   *
   * Appointments, documents, consents, messages and the patient's own details.
   * No `medical.*`, no `photos.*`, no prescribing: a coordinator arranging a
   * flight has no reason to be able to write in a medical record, and the
   * point of keeping a second role at all is that this line exists.
   */
  [Role.COORDINATOR]: new Set([
    // Counts, not money. `finance.report` is what unlocks revenue on the
    // analytics screen, and it stays with DOCTOR — a coordinator planning
    // capacity needs to know how many patients came, not what they paid.
    'analytics.read',
    'appointments.read',
    'appointments.write',
    'consents.collect',
    'consents.read',
    'documents.read',
    'documents.write',
    /*
     * The first rung of the escalation ladder.
     *
     * When NURSE went, the coordinator became the first person an emergency
     * wakes — so they have to be able to pick it up and close it, or the
     * first two minutes of every alarm go to somebody who can only watch.
     * This is the one place a coordinator sees clinical detail: the
     * break-glass view carries blood type, allergies and the last operation,
     * and every opening of it is audited.
     */
    'emergency.receive',
    'emergency.resolve',
    // A patient list for logistics. The money columns are refused separately,
    // by `finance.report`, which stays with DOCTOR — so a coordinator can
    // export who is arriving this week and not what they were charged.
    'export.create',
    'messages.read',
    'messages.write',
    'patients.read',
    'patients.write',
  ]),

  /** Their own record, and the emergency button. */
  [Role.PATIENT]: new Set(['self.emergency', 'self.message', 'self.read', 'self.write']),
};

/** Every permission any role holds. */
export const ALL_PERMISSIONS: ReadonlySet<string> = new Set(
  Object.values(ROLE_PERMISSIONS).flatMap((codes) => [...codes]),
);

/** The roles that hold a given permission. Used to find who to alert. */
export function rolesWith(permission: string): Role[] {
  return (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) =>
    ROLE_PERMISSIONS[role].has(permission),
  );
}
