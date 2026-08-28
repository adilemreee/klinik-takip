import { MeasurementType } from '@prisma/client';
import { BmiCategory, calculateBmi, categoriseBmi, checkPlausible } from './bmi';

describe('BMI', () => {
  /**
   * Height arrives in centimetres, which is how it is entered and stored.
   * Treating it as metres is the classic factor-of-10000 error, and it produces
   * a number small enough to look like a plausible mistake rather than an
   * obvious one.
   */
  it('converts centimetres correctly', () => {
    expect(calculateBmi(70, 175)).toBe(22.9);
    expect(calculateBmi(100, 180)).toBe(30.9);
    expect(calculateBmi(50, 160)).toBe(19.5);
  });

  it('rounds to one decimal place', () => {
    // 22.857… — more precision than BMI justifies, and an unstable rounding
    // would make the category flicker between reads.
    expect(calculateBmi(70, 175)).toBe(22.9);
  });

  it('refuses a height of zero rather than returning infinity', () => {
    expect(() => calculateBmi(70, 0)).toThrow(/positive/);
  });

  /**
   * The WHO boundaries, tested from both sides. 24.9 and 25.0 belong to
   * different categories, and a patient reading their own file notices when the
   * label disagrees with the number.
   */
  it.each([
    [18.4, BmiCategory.UNDERWEIGHT],
    [18.5, BmiCategory.NORMAL],
    [24.9, BmiCategory.NORMAL],
    [25.0, BmiCategory.OVERWEIGHT],
    [29.9, BmiCategory.OVERWEIGHT],
    [30.0, BmiCategory.OBESE_I],
    [34.9, BmiCategory.OBESE_I],
    [35.0, BmiCategory.OBESE_II],
    [39.9, BmiCategory.OBESE_II],
    [40.0, BmiCategory.OBESE_III],
  ])('places %s in %s', (bmi, expected) => {
    expect(categoriseBmi(bmi)).toBe(expected);
  });
});

describe('plausibility', () => {
  /**
   * A weight typed as 720 instead of 72 does not merely ruin a chart axis:
   * body weight drives dosing (spec M9), so an impossible value is refused at
   * the door rather than stored and trusted later.
   */
  it.each([
    [MeasurementType.WEIGHT, 720],
    [MeasurementType.WEIGHT, 0],
    [MeasurementType.HEIGHT, 17],
    [MeasurementType.HEIGHT, 1750],
    [MeasurementType.PULSE, 400],
    [MeasurementType.TEMPERATURE, 3.6],
    [MeasurementType.SPO2, 150],
  ])('refuses %s of %s', (type, value) => {
    expect(checkPlausible(type, value).ok).toBe(false);
  });

  it.each([
    [MeasurementType.WEIGHT, 72],
    [MeasurementType.HEIGHT, 175],
    [MeasurementType.PULSE, 68],
    [MeasurementType.TEMPERATURE, 36.6],
    [MeasurementType.SPO2, 98],
    [MeasurementType.GLUCOSE, 95],
  ])('accepts %s of %s', (type, value) => {
    expect(checkPlausible(type, value).ok).toBe(true);
  });

  /**
   * Wide on purpose. The bounds exist to catch transposed digits and unit
   * confusion, not to argue with a clinician about a real patient.
   */
  it('accepts values that are extreme but real', () => {
    expect(checkPlausible(MeasurementType.WEIGHT, 250).ok).toBe(true);
    expect(checkPlausible(MeasurementType.SPO2, 82).ok).toBe(true);
    expect(checkPlausible(MeasurementType.TEMPERATURE, 41.5).ok).toBe(true);
  });

  describe('blood pressure', () => {
    it('needs both numbers', () => {
      const result = checkPlausible(MeasurementType.BLOOD_PRESSURE, 120);

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/both/);
    });

    it('accepts a normal reading', () => {
      expect(checkPlausible(MeasurementType.BLOOD_PRESSURE, 120, 80).ok).toBe(true);
    });

    /** Systolic below diastolic is a transposition, not a patient. */
    it('refuses the two numbers the wrong way round', () => {
      const result = checkPlausible(MeasurementType.BLOOD_PRESSURE, 80, 120);

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/higher/);
    });

    it('refuses two identical numbers', () => {
      expect(checkPlausible(MeasurementType.BLOOD_PRESSURE, 100, 100).ok).toBe(false);
    });
  });
});
