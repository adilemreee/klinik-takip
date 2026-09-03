/**
 * The escalation ladder (spec M8).
 *
 * Two minutes to the second person, five to the doctor. The numbers are the
 * spec's; what this file adds is the part the spec leaves implicit — *who* each
 * rung is, and what happens when a rung turns out to be nobody.
 */

export interface EscalationStep {
  /** Stored on the event as `escalationLevel`: the highest rung notified. */
  level: number;
  /** Minutes after the trigger at which this rung is reached. */
  afterMinutes: number;
}

/**
 * Rung 0 goes out with the trigger itself; there is no waiting for a sweep to
 * notice it.
 */
export const ESCALATION_LADDER: EscalationStep[] = [
  { level: 0, afterMinutes: 0 },
  { level: 1, afterMinutes: 2 },
  { level: 2, afterMinutes: 5 },
];

/**
 * The next rung that has come due, or null while none has.
 *
 * Only ever one rung at a time, and only forward: a sweep that was late — the
 * worker restarted, the queue backed up — must not fire rungs 1 and 2 together
 * and turn a ladder into a single shout.
 */
export function dueEscalation(
  triggeredAt: Date,
  notifiedLevel: number,
  now: Date = new Date(),
): number | null {
  const elapsedMinutes = (now.getTime() - triggeredAt.getTime()) / 60_000;

  for (const step of ESCALATION_LADDER) {
    if (step.level <= notifiedLevel) continue;
    if (elapsedMinutes >= step.afterMinutes) return step.level;
    // The ladder is ordered, so the first rung not yet due means none is.
    return null;
  }

  return null;
}

/** The last rung: once it is notified there is nobody further to wake. */
export function isFinalLevel(level: number, chainLength: number): boolean {
  return level >= chainLength - 1;
}

export interface CareTeam {
  /** User ids of nurses assigned to this patient. */
  nurses: string[];
  /** User ids of coordinators assigned to this patient. */
  coordinators: string[];
  /** The patient's doctor of record, if they have one. */
  doctorUserId: string | null;
  /**
   * Everyone holding `emergency.receive`. Not a rung of its own so much as the
   * floor under the ladder.
   */
  receivers: string[];
}

/**
 * Who to wake, in order.
 *
 * Three rules, and each of them exists because of a way this fails quietly:
 *
 *   1. **Empty rungs collapse.** A patient with no nurse assigned would
 *      otherwise have rung 0 notify nobody — the alarm would sit silent for two
 *      minutes before anyone heard it, which is most of the time this feature
 *      has.
 *   2. **Nobody appears twice.** A doctor who is also the assigned coordinator
 *      is one phone; listing them on two rungs would spend an escalation step
 *      re-alerting a device that is already showing the alert.
 *   3. **The chain ends with everyone who can receive one.** A patient with no
 *      care team at all is exactly the patient nobody is watching.
 *
 * The result can still be empty, and that is not this function's to paper over:
 * it means no account in the clinic holds `emergency.receive`, which is a
 * misconfiguration the caller must shout about rather than a case to invent a
 * recipient for.
 */
export function escalationChain(team: CareTeam): string[][] {
  const groups: string[][] = [
    team.nurses,
    team.coordinators,
    team.doctorUserId ? [team.doctorUserId] : [],
    team.receivers,
  ];

  const seen = new Set<string>();
  const chain: string[][] = [];

  for (const group of groups) {
    const rung = group.filter((userId) => {
      if (seen.has(userId)) return false;
      seen.add(userId);
      return true;
    });

    if (rung.length > 0) chain.push(rung);
  }

  // Three rungs is the ladder the spec describes; a fourth would keep alerting
  // people after the doctor has already been woken, which is noise rather than
  // escalation.
  return chain.slice(0, ESCALATION_LADDER.length);
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * A location good enough to put a pin on, or nothing.
 *
 * Deliberately not a validation error: a patient whose phone reported a
 * nonsense fix, or refused to report one at all, still needs the alarm to go
 * out. Refusing the request would turn a missing convenience into a missing
 * emergency. What must not happen is storing the nonsense — (0, 0) is in the
 * Atlantic, and a pin there reads as a location rather than as an absence.
 */
export function sanitiseLocation(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): Coordinates | null {
  if (latitude === null || latitude === undefined) return null;
  if (longitude === null || longitude === undefined) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;

  // Null Island. A GPS that has not got a fix yet reports exactly this, and it
  // arrives far more often than a patient genuinely in the Gulf of Guinea.
  if (latitude === 0 && longitude === 0) return null;

  return { latitude, longitude };
}
