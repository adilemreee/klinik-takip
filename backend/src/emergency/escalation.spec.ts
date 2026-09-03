import {
  dueEscalation,
  escalationChain,
  isFinalLevel,
  sanitiseLocation,
  type CareTeam,
} from './escalation';

const trigger = new Date('2026-03-04T10:00:00.000Z');
const at = (seconds: number): Date => new Date(trigger.getTime() + seconds * 1000);

const team = (overrides: Partial<CareTeam> = {}): CareTeam => ({
  nurses: [],
  coordinators: [],
  doctorUserId: null,
  receivers: [],
  ...overrides,
});

/**
 * The escalation ladder.
 *
 * The failure this guards against does not look like a failure: an alarm is
 * raised, the row is written, the queue shows it — and nobody's phone ever
 * lit up, because the rung it went to had no one on it.
 */
describe('escalation timing', () => {
  it('reaches nobody new while the first two minutes are still running', () => {
    expect(dueEscalation(trigger, 0, at(119))).toBeNull();
  });

  it('reaches the second rung at two minutes', () => {
    expect(dueEscalation(trigger, 0, at(120))).toBe(1);
  });

  it('reaches the doctor at five', () => {
    expect(dueEscalation(trigger, 1, at(300))).toBe(2);
  });

  it('does not reach the doctor before five, however long rung one waited', () => {
    expect(dueEscalation(trigger, 1, at(299))).toBeNull();
  });

  /**
   * A worker that restarted, or a queue that backed up, arrives late with both
   * rungs due at once. Firing them together would wake the second contact and
   * the doctor in the same second and spend the whole ladder in one step — the
   * ladder exists so that somebody is still in reserve.
   */
  it('climbs one rung at a time when the sweep is late', () => {
    expect(dueEscalation(trigger, 0, at(600))).toBe(1);
    expect(dueEscalation(trigger, 1, at(600))).toBe(2);
  });

  it('has nothing left after the top rung', () => {
    expect(dueEscalation(trigger, 2, at(86_400))).toBeNull();
  });

  it('knows when a rung is the last one', () => {
    expect(isFinalLevel(2, 3)).toBe(true);
    expect(isFinalLevel(1, 3)).toBe(false);
    // A short chain — a patient whose whole care team is one nurse — tops out
    // earlier, and the sweep must stop rather than wait for a rung 2 that has
    // nobody on it.
    expect(isFinalLevel(0, 1)).toBe(true);
  });
});

describe('who each rung is', () => {
  it('goes nurse, then coordinator, then doctor', () => {
    expect(
      escalationChain(
        team({ nurses: ['n1'], coordinators: ['c1'], doctorUserId: 'd1', receivers: ['n1', 'c1', 'd1'] }),
      ),
    ).toEqual([['n1'], ['c1'], ['d1']]);
  });

  it('alerts every nurse on the first rung, not just one of them', () => {
    const chain = escalationChain(team({ nurses: ['n1', 'n2'], doctorUserId: 'd1' }));

    expect(chain[0]).toEqual(['n1', 'n2']);
  });

  /**
   * The case this whole collapse rule exists for: a patient with no nurse
   * assigned. Left uncollapsed the first alarm goes to an empty rung, and the
   * first two minutes — most of the time this feature has — pass in silence.
   */
  it('gives the first alarm to the coordinator when no nurse is assigned', () => {
    expect(
      escalationChain(team({ coordinators: ['c1'], doctorUserId: 'd1', receivers: ['x'] })),
    ).toEqual([['c1'], ['d1'], ['x']]);
  });

  it('gives the first alarm to the doctor when nobody else is assigned', () => {
    expect(escalationChain(team({ doctorUserId: 'd1', receivers: ['d1', 'x'] }))).toEqual([
      ['d1'],
      ['x'],
    ]);
  });

  /**
   * A patient with no care team at all is precisely the patient nobody is
   * watching, so the floor under the ladder is everyone who can receive one.
   */
  it('falls through to everyone who can receive an alert', () => {
    expect(escalationChain(team({ receivers: ['a', 'b'] }))).toEqual([['a', 'b']]);
  });

  it('never puts the same person on two rungs', () => {
    const chain = escalationChain(
      team({ nurses: ['same'], coordinators: ['same'], doctorUserId: 'same', receivers: ['same', 'other'] }),
    );

    expect(chain).toEqual([['same'], ['other']]);
  });

  it('stops at three rungs even when a fourth group exists', () => {
    const chain = escalationChain(
      team({ nurses: ['n'], coordinators: ['c'], doctorUserId: 'd', receivers: ['r'] }),
    );

    expect(chain).toHaveLength(3);
    expect(chain.flat()).not.toContain('r');
  });

  /**
   * Returned empty rather than papered over: there is no recipient to invent,
   * and a caller that is handed a plausible-looking chain will not raise the
   * alarm about the configuration.
   */
  it('is empty when no account can receive an emergency', () => {
    expect(escalationChain(team())).toEqual([]);
  });
});

describe('the location on the alarm', () => {
  it('keeps a real fix', () => {
    expect(sanitiseLocation(41.0082, 28.9784)).toEqual({ latitude: 41.0082, longitude: 28.9784 });
  });

  it('drops a missing one without complaint', () => {
    expect(sanitiseLocation(undefined, undefined)).toBeNull();
    expect(sanitiseLocation(41.0082, null)).toBeNull();
  });

  /**
   * A phone that has not got a fix yet reports (0, 0). Stored, it puts a pin
   * in the Atlantic — which reads as a location, not as an absence, and sends
   * somebody looking at it.
   */
  it('drops Null Island', () => {
    expect(sanitiseLocation(0, 0)).toBeNull();
  });

  it('keeps a genuine zero on one axis', () => {
    expect(sanitiseLocation(51.4779, 0)).toEqual({ latitude: 51.4779, longitude: 0 });
  });

  it('drops coordinates outside the globe', () => {
    expect(sanitiseLocation(91, 0)).toBeNull();
    expect(sanitiseLocation(0, 181)).toBeNull();
    expect(sanitiseLocation(Number.NaN, 5)).toBeNull();
    expect(sanitiseLocation(Number.POSITIVE_INFINITY, 5)).toBeNull();
  });
});
