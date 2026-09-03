import { Currency } from '@prisma/client';
import { convert, type Rate } from './exchange';
import { ZERO, round, toAmountString, type Money } from './money';

/**
 * Adding up money that is in four currencies (spec M11).
 *
 * Each amount converts at the rate of **its own day** — a payment at the day it
 * was received, a bill at the day it was raised — so a report for last quarter
 * keeps giving last quarter's answer however the lira moves afterwards.
 *
 * What the totals carry, and the reason this is a module rather than a `reduce`
 * at the call site, is `unconverted`. An amount with no rate for its day is not
 * dropped and not converted at some other day's rate: it is reported in the
 * currency it is still in, next to a total that says it is incomplete. A single
 * number that quietly excludes eleven thousand euros is the failure mode this
 * exists to prevent.
 */

export interface Amount {
  currency: Currency;
  amount: Money;
}

export interface Convertible extends Amount {
  /** The day this amount converts at, `YYYY-MM-DD`. */
  on: string;
}

export interface Totals {
  /** The currency the caller asked for. */
  currency: Currency;
  /** The sum of everything that could be converted. */
  converted: Money;
  /** Every currency present, converted or not. The complete picture. */
  byCurrency: Amount[];
  /**
   * What has no usable rate, in its own currency.
   *
   * Non-empty means `converted` is not the whole answer, and every screen and
   * export that shows the total has to show this too.
   */
  unconverted: Amount[];
  /** Whether `converted` accounts for everything. */
  complete: boolean;
}

export function totalise(items: Convertible[], to: Currency, rates: Rate[]): Totals {
  const byCurrency = new Map<Currency, Money>();
  const unconverted = new Map<Currency, Money>();
  let converted = ZERO;

  for (const item of items) {
    byCurrency.set(item.currency, (byCurrency.get(item.currency) ?? ZERO).plus(item.amount));

    const result = convert(item.amount, item.currency, to, item.on, rates);

    if (result === null) {
      unconverted.set(item.currency, (unconverted.get(item.currency) ?? ZERO).plus(item.amount));
      continue;
    }

    converted = converted.plus(result.amount);
  }

  return {
    currency: to,
    converted: round(converted),
    byCurrency: listOf(byCurrency),
    unconverted: listOf(unconverted),
    complete: unconverted.size === 0,
  };
}

/** Largest first: the currency that matters most is the one at the top. */
function listOf(amounts: Map<Currency, Money>): Amount[] {
  return [...amounts.entries()]
    .map(([currency, amount]) => ({ currency, amount: round(amount) }))
    .sort((a, b) => b.amount.comparedTo(a.amount));
}

export interface AmountView {
  currency: Currency;
  amount: string;
}

/** `Totals` on the wire. Same shape, amounts as strings. */
export interface TotalsView {
  currency: Currency;
  converted: string;
  byCurrency: AmountView[];
  /** Non-empty means `converted` is not the whole answer. */
  unconverted: AmountView[];
  complete: boolean;
}

export function toTotalsView(totals: Totals): TotalsView {
  const amounts = (entries: Amount[]): AmountView[] =>
    entries.map((entry) => ({ currency: entry.currency, amount: toAmountString(entry.amount) }));

  return {
    currency: totals.currency,
    converted: toAmountString(totals.converted),
    byCurrency: amounts(totals.byCurrency),
    unconverted: amounts(totals.unconverted),
    complete: totals.complete,
  };
}
