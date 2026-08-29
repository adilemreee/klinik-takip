import { LabFlag } from '@prisma/client';

/**
 * How far above the reference range a value has to be before it is critical:
 * two more ranges' width, or twice the bound when only one is given.
 *
 * Relative rather than a fixed number, because reference ranges differ by
 * orders of magnitude between analytes — one threshold would call a slightly
 * high glucose critical and miss a haemoglobin at half its lower bound.
 */
const CRITICAL_MULTIPLE = 2;

/**
 * Below the range, critical means half the lower bound.
 *
 * A ratio and not a subtraction, which is what this was first written as. Two
 * ranges below a low bound is usually a negative number, so a value could never
 * reach it: a one-sided lower bound would have flagged LOW and never CRITICAL,
 * for every analyte where dropping is the dangerous direction. Caught by a test
 * that expected a haemoglobin of 5 to be critical and got LOW.
 */
const CRITICAL_LOW_RATIO = 0.5;

/**
 * Classifies a value against its reference range.
 *
 * Returns null when there is no range: a result with nothing to compare against
 * is not normal, it is unclassified, and colouring it green would say something
 * the report never said.
 */
export function classify(
  value: number,
  reference?: { low?: number | null; high?: number | null },
): LabFlag | null {
  const low = reference?.low ?? null;
  const high = reference?.high ?? null;

  if (low === null && high === null) return null;

  const span = low !== null && high !== null ? high - low : null;


  if (high !== null && value > high) {
    const margin = span !== null ? span * CRITICAL_MULTIPLE : high;
    return value > high + margin ? LabFlag.CRITICAL : LabFlag.HIGH;
  }

  if (low !== null && value < low) {
    return value < low * CRITICAL_LOW_RATIO ? LabFlag.CRITICAL : LabFlag.LOW;
  }

  return LabFlag.NORMAL;
}

/**
 * Below this, the engine's reading is shown for confirmation rather than
 * presented as read (spec M16: low-confidence fields are highlighted).
 *
 * Set where it is because OCR confidence is not a probability of correctness —
 * a clean digit misread as another clean digit scores high. It is a filter for
 * the obviously doubtful, not a substitute for the human check, which is why
 * nothing here is ever auto-approved.
 */
export const REVIEW_CONFIDENCE = 0.8;
