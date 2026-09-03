import { Prisma } from '@prisma/client';
import {
  MoneyError,
  ZERO,
  money,
  requirePositive,
  round,
  sum,
  toAmountString,
} from './money';

/**
 * Money arithmetic (spec M11, T6.3).
 *
 * The first test is the reason this module exists at all.
 */
describe('money', () => {
  it('adds the way a person adds, not the way a double does', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in floating point. Three of these in a
    // row on a bill of four thousand euros is a cent that nobody can account
    // for, and a bank reconciliation that never balances.
    expect(sum([money('0.1'), money('0.2')]).equals(money('0.3'))).toBe(true);

    const thirds = sum([money('33.33'), money('33.33'), money('33.34')]);
    expect(toAmountString(thirds)).toBe('100.00');
  });

  it('keeps a large amount exact', () => {
    // Beyond 2^53 a double starts skipping integers. Kuruş on a nine-figure
    // annual total are exactly where that shows up.
    const total = sum([money('99999999999.99'), money('0.01')]);
    expect(toAmountString(total)).toBe('100000000000.00');
  });

  describe('what it refuses to read as an amount', () => {
    it.each(['NaN', 'Infinity', '1e5', '0x1f', '', ' ', 'abc', '1,50', '--5'])(
      'refuses %p',
      (value) => {
        expect(() => money(value)).toThrow(MoneyError);
      },
    );

    it('refuses a number that is not finite', () => {
      expect(() => money(Number.NaN)).toThrow(MoneyError);
      expect(() => money(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    });

    it('accepts a plain decimal string', () => {
      expect(money('1250.00').toString()).toBe('1250');
      expect(money('-40.50').toString()).toBe('-40.5');
    });
  });

  describe('the wire form', () => {
    it('is a string with both places, always', () => {
      // A client that reads an amount into a double has lost before it starts,
      // and a column of figures with ragged decimals is unreadable.
      expect(toAmountString(money('1250'))).toBe('1250.00');
      expect(toAmountString(money('0'))).toBe('0.00');
      expect(toAmountString(money('-12.5'))).toBe('-12.50');
    });
  });

  describe('rounding', () => {
    it('goes half up, in both directions from zero', () => {
      expect(toAmountString(round(money('1.005')))).toBe('1.01');
      expect(toAmountString(round(money('1.004')))).toBe('1.00');
      expect(toAmountString(round(money('-1.005')))).toBe('-1.01');
    });

    it('is not applied until the end of a calculation', () => {
      // 1000 × 0.1234 rounded per step drifts; done once it does not.
      const rate = new Prisma.Decimal('0.12345678');
      expect(toAmountString(round(money('1000').times(rate)))).toBe('123.46');
    });
  });

  describe('guarding an amount from outside', () => {
    it('will not take zero for something that must be positive', () => {
      expect(() => requirePositive('0', 'amount')).toThrow(/greater than zero/);
      expect(() => requirePositive('-1', 'amount')).toThrow();
    });

    it('takes zero for something that may be nothing', () => {
      expect(requirePositive('0', 'discount', true).equals(ZERO)).toBe(true);
    });

    it('refuses more precision than the currency has', () => {
      // The column would round it silently, and a bill that does not say what
      // the clinician typed is worse than a rejected one.
      expect(() => requirePositive('10.005', 'amount')).toThrow(/decimal places/);
      expect(toAmountString(requirePositive('10.99', 'amount'))).toBe('10.99');
    });

    it('names the field it is complaining about', () => {
      expect(() => requirePositive('-1', 'agencyCommission', true)).toThrow(
        /agencyCommission/,
      );
    });
  });
});
