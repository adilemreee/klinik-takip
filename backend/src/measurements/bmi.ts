import { MeasurementType } from '@prisma/client';

/**
 * WHO body-mass-index categories.
 *
 * The boundaries are the WHO's, not rounded for convenience: 24.9 and 25.0 sit
 * in different categories and a patient reading their own file will notice if
 * the label disagrees with the number.
 */
export enum BmiCategory {
  UNDERWEIGHT = 'UNDERWEIGHT',
  NORMAL = 'NORMAL',
  OVERWEIGHT = 'OVERWEIGHT',
  OBESE_I = 'OBESE_I',
  OBESE_II = 'OBESE_II',
  OBESE_III = 'OBESE_III',
}

/**
 * Plausible ranges, per measurement type and unit.
 *
 * Not cosmetic. A weight typed as 720 instead of 72 does not merely ruin a
 * chart axis — body weight drives dosing (spec M9), so a value no human has
 * is refused at the door rather than stored and trusted later.
 *
 * Bounds are deliberately wide: they exist to catch transposed digits and
 * unit confusion, not to second-guess a clinician about a real patient.
 */
export const PLAUSIBLE_RANGES: Record<MeasurementType, { min: number; max: number; unit: string }> =
  {
    WEIGHT: { min: 1, max: 400, unit: 'kg' },
    HEIGHT: { min: 30, max: 260, unit: 'cm' },
    BMI: { min: 5, max: 200, unit: 'kg/m2' },
    BLOOD_PRESSURE: { min: 40, max: 300, unit: 'mmHg' },
    PULSE: { min: 20, max: 250, unit: 'bpm' },
    TEMPERATURE: { min: 25, max: 45, unit: 'C' },
    SPO2: { min: 50, max: 100, unit: '%' },
    GLUCOSE: { min: 10, max: 900, unit: 'mg/dL' },
    WAIST: { min: 30, max: 250, unit: 'cm' },
  };

export interface PlausibilityResult {
  ok: boolean;
  reason?: string;
}

export function checkPlausible(
  type: MeasurementType,
  value: number,
  secondaryValue?: number,
): PlausibilityResult {
  const range = PLAUSIBLE_RANGES[type];

  if (!Number.isFinite(value) || value < range.min || value > range.max) {
    return {
      ok: false,
      reason: `${type} must be between ${range.min} and ${range.max} ${range.unit}`,
    };
  }

  if (type === MeasurementType.BLOOD_PRESSURE) {
    if (secondaryValue === undefined) {
      return { ok: false, reason: 'Blood pressure needs both systolic and diastolic values' };
    }

    if (secondaryValue < range.min || secondaryValue > range.max) {
      return {
        ok: false,
        reason: `Diastolic must be between ${range.min} and ${range.max} ${range.unit}`,
      };
    }

    // Systolic below diastolic is a transposition, not a patient.
    if (secondaryValue >= value) {
      return { ok: false, reason: 'Systolic must be higher than diastolic' };
    }
  }

  return { ok: true };
}

/**
 * BMI from weight in kilograms and height in centimetres.
 *
 * Height is taken in centimetres because that is how it is entered and stored;
 * converting at the boundary rather than expecting metres is what keeps the
 * classic factor-of-10000 error out of the calculation.
 */
export function calculateBmi(weightKg: number, heightCm: number): number {
  if (heightCm <= 0) {
    throw new Error('Height must be positive');
  }

  const heightM = heightCm / 100;

  // One decimal place: BMI is not precise enough to justify more, and a stable
  // rounding keeps the category from flickering between reads.
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}

export function categoriseBmi(bmi: number): BmiCategory {
  if (bmi < 18.5) return BmiCategory.UNDERWEIGHT;
  if (bmi < 25) return BmiCategory.NORMAL;
  if (bmi < 30) return BmiCategory.OVERWEIGHT;
  if (bmi < 35) return BmiCategory.OBESE_I;
  if (bmi < 40) return BmiCategory.OBESE_II;
  return BmiCategory.OBESE_III;
}
