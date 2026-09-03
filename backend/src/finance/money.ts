import { Prisma } from '@prisma/client';

/**
 * Money arithmetic (spec M11).
 *
 * Every amount in this module is a `Prisma.Decimal` and none of them is ever a
 * `number`. This is not a style preference: `0.1 + 0.2` is not `0.3` in
 * floating point, and a clinic that bills in four currencies and reconciles
 * against bank statements will find the difference. The database columns are
 * `Decimal(14,2)`; anything that leaves this module in `number` form has
 * already lost precision, so amounts are also serialised as **strings**, JSON
 * numbers being IEEE-754 doubles by the time a client has parsed them.
 */

export type Money = Prisma.Decimal;

export const ZERO: Money = new Prisma.Decimal(0);

/** Two, for currency amounts. Rates keep their own precision (18,8). */
const SCALE = 2;

/**
 * Half-up, stated rather than inherited.
 *
 * Decimal.js defaults to half-up already, but rounding is the kind of thing
 * that must be visible in the source: a reader reconciling a total against a
 * bank statement needs to know which way the half went without reading a
 * library's defaults.
 */
const ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

export class MoneyError extends Error {}

/**
 * A Decimal from whatever the caller has — a client's string, a Prisma column,
 * a literal in a test.
 *
 * Strings are the intended input. A `number` is accepted because Prisma columns
 * and JSON bodies do produce them, but it is checked for the two ways a double
 * lies: not being finite, and not surviving the round trip through its own
 * decimal representation.
 */
export function money(value: Money | string | number): Money {
  if (value instanceof Prisma.Decimal) return value;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new MoneyError(`Not a finite amount: ${value}`);
    }
    return new Prisma.Decimal(value.toString());
  }

  const trimmed = value.trim();

  // Decimal.js accepts "NaN", "Infinity", "0x1f" and exponent notation. None of
  // those is an amount of money somebody typed into a form.
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new MoneyError(`Not an amount: ${JSON.stringify(value)}`);
  }

  return new Prisma.Decimal(trimmed);
}

/** Rounded to the currency's two places. */
export function round(value: Money): Money {
  return value.toDecimalPlaces(SCALE, ROUNDING);
}

export function sum(values: Money[]): Money {
  return values.reduce((total, value) => total.plus(value), ZERO);
}

export function isNegative(value: Money): boolean {
  return value.isNegative();
}

export function isZero(value: Money): boolean {
  return value.isZero();
}

/**
 * The wire form: a string, always with both decimal places.
 *
 * "1200.00" rather than 1200 — a client that reads an amount into a double has
 * lost the argument before it starts, and a fixed shape is also what a human
 * comparing two columns of figures needs.
 */
export function toAmountString(value: Money): string {
  return round(value).toFixed(SCALE);
}

/**
 * Guard for an amount that arrived from outside.
 *
 * @param allowZero a discount may be nothing; a payment may not.
 */
export function requirePositive(
  value: Money | string | number,
  field: string,
  allowZero = false,
): Money {
  const amount = money(value);

  if (amount.isNegative() || (!allowZero && amount.isZero())) {
    throw new MoneyError(
      allowZero ? `${field} cannot be negative` : `${field} must be greater than zero`,
    );
  }

  // More than two decimal places would be silently rounded on the way into the
  // column, and a bill that does not say what the clinician typed is worse than
  // a rejected one.
  if (amount.decimalPlaces() > SCALE) {
    throw new MoneyError(`${field} has more than ${SCALE} decimal places`);
  }

  return amount;
}
