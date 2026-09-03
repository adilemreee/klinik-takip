import { Currency } from '@prisma/client';
import { dayToDate, type Rate } from './exchange';
import { money, toAmountString } from './money';
import { totalise, type Convertible } from './totals';

/**
 * Adding up money in four currencies (spec M11, T6.3).
 *
 * The failure this exists to prevent: one confident number that quietly leaves
 * out the amounts it had no rate for.
 */
describe('totals', () => {
  const rate = (base: Currency, quote: Currency, value: string, day: string): Rate => ({
    base,
    quote,
    rate: money(value),
    validOn: dayToDate(day),
  });

  const rates: Rate[] = [
    rate(Currency.EUR, Currency.TRY, '38.00', '2026-03-02'),
    rate(Currency.EUR, Currency.TRY, '40.00', '2026-03-20'),
    rate(Currency.USD, Currency.TRY, '35.00', '2026-03-02'),
  ];

  const item = (currency: Currency, amount: string, on: string): Convertible => ({
    currency,
    amount: money(amount),
    on,
  });

  it('converts each amount at its own day', () => {
    // Two identical euro payments a fortnight apart are not worth the same in
    // lira, and pretending they are is how a quarter's revenue moves after the
    // quarter has closed.
    const totals = totalise(
      [item(Currency.EUR, '1000.00', '2026-03-02'), item(Currency.EUR, '1000.00', '2026-03-20')],
      Currency.TRY,
      rates,
    );

    expect(toAmountString(totals.converted)).toBe('78000.00');
    expect(totals.complete).toBe(true);
  });

  it('never drops what it cannot convert', () => {
    const totals = totalise(
      [
        item(Currency.EUR, '1000.00', '2026-03-02'),
        // No GBP rate anywhere.
        item(Currency.GBP, '2000.00', '2026-03-02'),
      ],
      Currency.TRY,
      rates,
    );

    expect(toAmountString(totals.converted)).toBe('38000.00');
    expect(totals.complete).toBe(false);
    expect(totals.unconverted.map((entry) => entry.currency)).toEqual([Currency.GBP]);
    expect(toAmountString(totals.unconverted[0]!.amount)).toBe('2000.00');
  });

  it('reports every currency present whether or not it converted', () => {
    // `byCurrency` is the complete picture; `converted` is the part with a
    // rate behind it. A screen showing only the second is showing a number
    // that is missing two thousand pounds.
    const totals = totalise(
      [item(Currency.EUR, '1000.00', '2026-03-02'), item(Currency.GBP, '2000.00', '2026-03-02')],
      Currency.TRY,
      rates,
    );

    expect(totals.byCurrency.map((entry) => entry.currency)).toEqual([
      Currency.GBP,
      Currency.EUR,
    ]);
  });

  it('adds amounts already in the report currency without a rate', () => {
    const totals = totalise([item(Currency.TRY, '500.00', '2026-03-02')], Currency.TRY, []);

    expect(toAmountString(totals.converted)).toBe('500.00');
    expect(totals.complete).toBe(true);
  });

  it('handles negative amounts, because a refund is one', () => {
    const totals = totalise(
      [item(Currency.EUR, '1000.00', '2026-03-02'), item(Currency.EUR, '-400.00', '2026-03-02')],
      Currency.TRY,
      rates,
    );

    expect(toAmountString(totals.converted)).toBe('22800.00');
    expect(toAmountString(totals.byCurrency[0]!.amount)).toBe('600.00');
  });

  it('is empty rather than wrong when there is nothing to add', () => {
    const totals = totalise([], Currency.EUR, rates);

    expect(toAmountString(totals.converted)).toBe('0.00');
    expect(totals.complete).toBe(true);
    expect(totals.byCurrency).toEqual([]);
  });
});
