import { LabFlag } from '@prisma/client';
import { classify } from './lab-flag';

/**
 * The flag decides what colour a number is on a doctor's screen, and whether it
 * raises an alert. Wrong in the reassuring direction is the dangerous one.
 */
describe('classifying a lab value', () => {
  const range = { low: 12, high: 16 };

  it('calls a value inside the range normal', () => {
    expect(classify(13.5, range)).toBe(LabFlag.NORMAL);
  });

  it('includes the bounds themselves', () => {
    expect(classify(12, range)).toBe(LabFlag.NORMAL);
    expect(classify(16, range)).toBe(LabFlag.NORMAL);
  });

  it('flags just outside the range as high or low', () => {
    expect(classify(16.1, range)).toBe(LabFlag.HIGH);
    expect(classify(11.9, range)).toBe(LabFlag.LOW);
  });

  it('flags far outside the range as critical', () => {
    expect(classify(25, range)).toBe(LabFlag.CRITICAL);
    expect(classify(5, range)).toBe(LabFlag.CRITICAL);
  });

  /**
   * The low side is a ratio, not a subtraction. Two ranges below a low bound is
   * usually negative, so a subtractive rule made CRITICAL unreachable — for
   * every analyte where dropping is the dangerous direction.
   */
  it('reaches critical below the range for a narrow bound', () => {
    expect(classify(5, { low: 12, high: 16 })).toBe(LabFlag.CRITICAL);
    expect(classify(0.2, { low: 0.6, high: 1.2 })).toBe(LabFlag.CRITICAL);
  });

  it('handles an upper bound with no lower one', () => {
    expect(classify(4, { high: 5 })).toBe(LabFlag.NORMAL);
    expect(classify(7, { high: 5 })).toBe(LabFlag.HIGH);
    expect(classify(30, { high: 5 })).toBe(LabFlag.CRITICAL);
  });

  it('handles a lower bound with no upper one', () => {
    expect(classify(50, { low: 40 })).toBe(LabFlag.NORMAL);
    expect(classify(35, { low: 40 })).toBe(LabFlag.LOW);
    expect(classify(5, { low: 40 })).toBe(LabFlag.CRITICAL);
  });

  /**
   * A value with nothing to compare against is unclassified, not normal.
   * Colouring it green would tell the doctor something the report never said.
   */
  it('refuses to classify without a reference range', () => {
    expect(classify(13.5)).toBeNull();
    expect(classify(13.5, {})).toBeNull();
  });

  /**
   * A single fixed threshold would call a slightly high glucose critical and
   * miss a haemoglobin at half its lower bound.
   */
  it('scales the critical margin to the range', () => {
    // A wide range tolerates a wide excursion.
    expect(classify(150, { low: 70, high: 100 })).toBe(LabFlag.HIGH);
    expect(classify(200, { low: 70, high: 100 })).toBe(LabFlag.CRITICAL);

    // A narrow one does not.
    expect(classify(1.5, { low: 0.6, high: 1.2 })).toBe(LabFlag.HIGH);
    expect(classify(3, { low: 0.6, high: 1.2 })).toBe(LabFlag.CRITICAL);
  });
});
