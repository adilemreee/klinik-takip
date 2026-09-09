import { ageOn, wholeDaysBetween } from './file-summary.service';

/**
 * The two calculations on the file header that a client must not repeat.
 *
 * Age and "days since surgery" appear on the card, in the emergency snapshot
 * and in the discharge advice; computing them in three places is how two
 * screens end up disagreeing about how old somebody is.
 */
describe('ageOn', () => {
  it('counts the birthday, not the elapsed days', () => {
    // The day before turning forty.
    expect(ageOn(new Date('1986-09-10T00:00:00Z'), new Date('2026-09-09T12:00:00Z'))).toBe(39);
    // The birthday itself.
    expect(ageOn(new Date('1986-09-09T00:00:00Z'), new Date('2026-09-09T12:00:00Z'))).toBe(40);
  });

  it('handles a 29 February birthday in a common year', () => {
    // Nobody turns "undefined" on 28 February; the birthday has not come round.
    expect(ageOn(new Date('2004-02-29T00:00:00Z'), new Date('2026-02-28T12:00:00Z'))).toBe(21);
    expect(ageOn(new Date('2004-02-29T00:00:00Z'), new Date('2026-03-01T12:00:00Z'))).toBe(22);
  });

  it('never returns a negative age for a date entered wrong', () => {
    expect(ageOn(new Date('2030-01-01T00:00:00Z'), new Date('2026-09-09T00:00:00Z'))).toBe(0);
  });
});

describe('wholeDaysBetween', () => {
  it('counts whole days, so an operation this morning is day zero', () => {
    expect(
      wholeDaysBetween(new Date('2026-09-09T06:00:00Z'), new Date('2026-09-09T23:00:00Z')),
    ).toBe(0);
    expect(
      wholeDaysBetween(new Date('2026-09-08T06:00:00Z'), new Date('2026-09-09T07:00:00Z')),
    ).toBe(1);
  });

  it('clamps a future date rather than reporting negative days', () => {
    expect(
      wholeDaysBetween(new Date('2026-09-20T00:00:00Z'), new Date('2026-09-09T00:00:00Z')),
    ).toBe(0);
  });
});
