import { Currency } from '@prisma/client';
import { localDate, type LocalDate } from '../common/local-calendar';
import { money, round, type Money } from './money';

/**
 * Converting between currencies with a dated rate (spec M11).
 *
 * Amounts are stored in the currency they were billed in and converted only
 * when a report asks for a single total. Doing it the other way round — storing
 * everything in one currency at the rate of the day it was entered — means a
 * bill's recorded value depends on when somebody typed it in, and a report run
 * twice gives two answers.
 *
 * The interesting case is the missing rate, and it is the same problem as an
 * unrecognised drug in the interaction checker: **a record that cannot be
 * converted must never be silently dropped.** Dropping it understates revenue
 * by exactly the amount nobody is looking at, and using today's rate for last
 * quarter rewrites history. So the conversion returns null, and the reports
 * carry what they could not convert, in the currency it is still in.
 */

export interface Rate {
  base: Currency;
  quote: Currency;
  /** One unit of `base` costs this much `quote`. */
  rate: Money;
  validOn: Date;
}

export interface Converted {
  amount: Money;
  /** The rate actually used, after any inversion. */
  rate: Money;
  /** The day the rate is from, which may be earlier than the day asked for. */
  rateDate: Date;
  /** True when the rate was carried forward from an earlier day. */
  carriedForward: boolean;
}

/**
 * How stale a rate may be before it stops counting as a rate.
 *
 * Rates are published on working days, so a Sunday has to use Friday's and a
 * long public holiday can leave a four-day gap. Beyond a week, a "rate" is a
 * guess wearing a date, and a report that quietly used a month-old number is
 * worse than one that says it could not convert.
 */
export const MAX_RATE_AGE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar day a rate belongs to, as `YYYY-MM-DD`. */
export function rateDay(date: Date): string {
  // Rate validity is a `@db.Date` column: midnight UTC, no time part, no zone.
  return date.toISOString().slice(0, 10);
}

/** The rate day of an instant, in the clinic's calendar. */
export function rateDayOf(at: Date, timezone: string): string {
  return formatLocal(localDate(at, timezone));
}

function formatLocal(date: LocalDate): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** A day string back to the instant the stored column holds. */
export function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * The rate to use for `from`→`to` on a given day.
 *
 * Direct first, then the inverse of the opposite pair. Nothing is triangulated
 * through a third currency: a EUR→USD rate derived from two TRY rates is a
 * number this software invented, and inventing one is how a report becomes
 * confidently wrong. A report currency needs a rate against each currency in
 * the data, which is a handful of rows a day.
 */
export function rateOn(
  from: Currency,
  to: Currency,
  on: string,
  rates: Rate[],
): { rate: Money; rateDate: Date } | null {
  if (from === to) return { rate: money(1), rateDate: dayToDate(on) };

  const onDate = dayToDate(on);
  const oldestAllowed = new Date(onDate.getTime() - MAX_RATE_AGE_DAYS * DAY_MS);

  let best: { rate: Money; rateDate: Date; direct: boolean } | null = null;

  for (const candidate of rates) {
    if (candidate.validOn > onDate || candidate.validOn < oldestAllowed) continue;

    const direct = candidate.base === from && candidate.quote === to;
    const inverse = candidate.base === to && candidate.quote === from;

    if (!direct && !inverse) continue;
    if (candidate.rate.lte(0)) continue;

    const rate = direct ? candidate.rate : money(1).div(candidate.rate);

    // Newest wins; on the same day a directly quoted pair beats an inverted
    // one, which avoids a rounding difference depending on which row was read.
    if (
      best === null ||
      candidate.validOn > best.rateDate ||
      (candidate.validOn.getTime() === best.rateDate.getTime() && direct && !best.direct)
    ) {
      best = { rate, rateDate: candidate.validOn, direct };
    }
  }

  return best === null ? null : { rate: best.rate, rateDate: best.rateDate };
}

export function convert(
  amount: Money,
  from: Currency,
  to: Currency,
  on: string,
  rates: Rate[],
): Converted | null {
  const found = rateOn(from, to, on, rates);
  if (found === null) return null;

  return {
    // Rounded once, at the end: rounding the rate first would drift by a lira
    // over a few hundred records.
    amount: round(amount.times(found.rate)),
    rate: found.rate,
    rateDate: found.rateDate,
    carriedForward: rateDay(found.rateDate) !== on,
  };
}
