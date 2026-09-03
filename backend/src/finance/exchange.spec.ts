import { Currency } from '@prisma/client';
import { MAX_RATE_AGE_DAYS, convert, dayToDate, rateDayOf, rateOn, type Rate } from './exchange';
import { money, toAmountString } from './money';

/**
 * Dated FX conversion (spec M11, T6.3).
 *
 * Two failures this is written against: a report that quietly used today's rate
 * for last quarter, and one that quietly dropped the amounts it could not
 * convert. The second is the dangerous one, because the number still looks
 * like an answer.
 */
describe('exchange rates', () => {
  const rate = (base: Currency, quote: Currency, value: string, day: string): Rate => ({
    base,
    quote,
    rate: money(value),
    validOn: dayToDate(day),
  });

  const rates: Rate[] = [
    rate(Currency.EUR, Currency.TRY, '38.00', '2026-03-02'),
    rate(Currency.EUR, Currency.TRY, '39.00', '2026-03-09'),
    rate(Currency.USD, Currency.TRY, '35.00', '2026-03-09'),
  ];

  it('needs no rate for a currency against itself', () => {
    const result = convert(money('100.00'), Currency.TRY, Currency.TRY, '2026-03-09', []);

    expect(toAmountString(result!.amount)).toBe('100.00');
  });

  it('uses the rate of the day asked for', () => {
    const result = convert(money('1000.00'), Currency.EUR, Currency.TRY, '2026-03-09', rates);

    expect(toAmountString(result!.amount)).toBe('39000.00');
    expect(result!.carriedForward).toBe(false);
  });

  it('does not reach forward to a rate that had not been published yet', () => {
    // A March 2nd payment is worth March 2nd's rate however the lira moved
    // afterwards. This is the property that stops a report changing its own
    // history every time it is run.
    const result = convert(money('1000.00'), Currency.EUR, Currency.TRY, '2026-03-02', rates);

    expect(toAmountString(result!.amount)).toBe('38000.00');
  });

  it('carries the last rate forward over a weekend, and says so', () => {
    const result = convert(money('1000.00'), Currency.EUR, Currency.TRY, '2026-03-07', rates);

    expect(toAmountString(result!.amount)).toBe('38000.00');
    expect(result!.carriedForward).toBe(true);
    expect(result!.rateDate).toEqual(dayToDate('2026-03-02'));
  });

  it('stops carrying forward once the rate is stale', () => {
    // Beyond a week a "rate" is a guess wearing a date. A report that says it
    // could not convert is more useful than one that used a month-old number.
    const wellPast = dayToDate('2026-03-02');
    wellPast.setUTCDate(wellPast.getUTCDate() + MAX_RATE_AGE_DAYS + 1);

    const result = convert(
      money('1000.00'),
      Currency.EUR,
      Currency.TRY,
      wellPast.toISOString().slice(0, 10),
      [rates[0]!],
    );

    expect(result).toBeNull();
  });

  it('inverts a rate quoted the other way round', () => {
    const result = convert(money('38000.00'), Currency.TRY, Currency.EUR, '2026-03-02', rates);

    expect(toAmountString(result!.amount)).toBe('1000.00');
  });

  it('prefers a directly quoted pair to an inverted one on the same day', () => {
    // Otherwise which row happens to be read first decides the last kuruş.
    const both: Rate[] = [
      rate(Currency.TRY, Currency.EUR, '0.02631579', '2026-03-09'),
      rate(Currency.EUR, Currency.TRY, '38.00', '2026-03-09'),
    ];

    const found = rateOn(Currency.EUR, Currency.TRY, '2026-03-09', both);

    expect(found!.rate.toString()).toBe('38');
  });

  it('will not invent a cross rate out of two others', () => {
    // EUR→USD could be derived from the two TRY pairs above. It is not: a
    // number this software made up is how a report becomes confidently wrong,
    // and the clinic can enter the pair it actually uses.
    const result = convert(money('1000.00'), Currency.EUR, Currency.USD, '2026-03-09', rates);

    expect(result).toBeNull();
  });

  it('reads the rate day in the clinic calendar, not UTC', () => {
    // 00:30 on the 10th in Istanbul is 21:30 on the 9th in UTC. The rate that
    // applies is the one for the day the clinic was living in.
    const justAfterMidnight = new Date('2026-03-09T21:30:00.000Z');

    expect(rateDayOf(justAfterMidnight, 'Europe/Istanbul')).toBe('2026-03-10');
    expect(rateDayOf(justAfterMidnight, 'UTC')).toBe('2026-03-09');
  });

  it('ignores a rate of zero rather than dividing by it', () => {
    const broken: Rate[] = [rate(Currency.TRY, Currency.EUR, '0', '2026-03-09')];

    expect(rateOn(Currency.EUR, Currency.TRY, '2026-03-09', broken)).toBeNull();
  });
});
