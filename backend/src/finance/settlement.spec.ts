import { PaymentKind, PaymentStatus } from '@prisma/client';
import { money, toAmountString } from './money';
import { settle, type LedgerEntry } from './settlement';

/**
 * Deriving payment status from the ledger (spec M11, T6.3).
 *
 * What is being defended here: a bill whose status disagrees with the money
 * against it. A bill marked PAID with nothing collected drops out of the
 * receivables report and is never chased again, and nothing anywhere would
 * show that something had gone wrong.
 */
describe('settlement', () => {
  const day = (n: number): Date => new Date(Date.UTC(2026, 2, n));

  const payment = (
    amount: string,
    on = 1,
    kind: PaymentKind = PaymentKind.PAYMENT,
  ): LedgerEntry => ({
    kind,
    appliedAmount: money(amount),
    paidAt: day(on),
    reversedAt: null,
  });

  const net = money('4000.00');

  it('is pending with nothing against it', () => {
    const result = settle(net, []);

    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(toAmountString(result.paid)).toBe('0.00');
    expect(toAmountString(result.balance)).toBe('4000.00');
    expect(result.paidAt).toBeNull();
  });

  it('is partial after a deposit', () => {
    const result = settle(net, [payment('1500.00')]);

    expect(result.status).toBe(PaymentStatus.PARTIAL);
    expect(toAmountString(result.balance)).toBe('2500.00');
    expect(result.paidAt).toBeNull();
  });

  it('is paid when the instalments add up', () => {
    const result = settle(net, [payment('1500.00', 1), payment('2500.00', 8)]);

    expect(result.status).toBe(PaymentStatus.PAID);
    expect(toAmountString(result.balance)).toBe('0.00');
    // The day it was settled, not the day the first money arrived.
    expect(result.paidAt).toEqual(day(8));
  });

  it('does not round a bill into being paid', () => {
    // One kuruş short is not paid. This is the whole argument for Decimal:
    // in floating point these three add to 3999.9999999999995 and a `>=`
    // written against a rounded number would call it settled.
    const result = settle(net, [
      payment('1333.33', 1),
      payment('1333.33', 2),
      payment('1333.33', 3),
    ]);

    expect(result.status).toBe(PaymentStatus.PARTIAL);
    expect(toAmountString(result.balance)).toBe('0.01');
  });

  describe('a reversed payment', () => {
    it('stops counting, and the bill goes back into debt', () => {
      const mistake: LedgerEntry = { ...payment('4000.00'), reversedAt: day(2) };
      const result = settle(net, [mistake]);

      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(toAmountString(result.paid)).toBe('0.00');
      expect(result.paidAt).toBeNull();
    });

    it('leaves the rest of the ledger alone', () => {
      const result = settle(net, [
        payment('1500.00', 1),
        { ...payment('2500.00', 2), reversedAt: day(3) },
      ]);

      expect(result.status).toBe(PaymentStatus.PARTIAL);
      expect(toAmountString(result.paid)).toBe('1500.00');
    });
  });

  describe('refunds', () => {
    it('are not the same thing as a payment that never happened', () => {
      // Money that came in and went back out. A collection report that cannot
      // tell this apart from PENDING sends somebody to chase a patient who has
      // already been refunded.
      const result = settle(net, [
        payment('4000.00', 1),
        payment('4000.00', 5, PaymentKind.REFUND),
      ]);

      expect(result.status).toBe(PaymentStatus.REFUNDED);
      expect(toAmountString(result.refunded)).toBe('4000.00');
      expect(toAmountString(result.paid)).toBe('0.00');
    });

    it('put a settled bill back into partial when only part comes back', () => {
      const result = settle(net, [
        payment('4000.00', 1),
        payment('1000.00', 5, PaymentKind.REFUND),
      ]);

      expect(result.status).toBe(PaymentStatus.PARTIAL);
      expect(toAmountString(result.paid)).toBe('3000.00');
      expect(result.paidAt).toBeNull();
    });

    it('and a later payment settles it again, dated to the later payment', () => {
      const result = settle(net, [
        payment('4000.00', 1),
        payment('1000.00', 5, PaymentKind.REFUND),
        payment('1000.00', 9),
      ]);

      expect(result.status).toBe(PaymentStatus.PAID);
      // Not day 1: the bill has only been settled since day 9.
      expect(result.paidAt).toEqual(day(9));
    });
  });

  describe('cancellation', () => {
    it('beats whatever the amounts say', () => {
      const result = settle(net, [payment('4000.00')], day(10));

      expect(result.status).toBe(PaymentStatus.CANCELLED);
      // The money is still there to be accounted for, and usually refunded.
      expect(toAmountString(result.paid)).toBe('4000.00');
    });
  });

  describe('edges', () => {
    it('treats a complimentary procedure as settled, not outstanding', () => {
      const result = settle(money('0.00'), []);

      expect(result.status).toBe(PaymentStatus.PAID);
      expect(result.paidAt).toBeNull();
    });

    it('reports an overpayment as a negative balance rather than hiding it', () => {
      const result = settle(net, [payment('4500.00')]);

      expect(result.status).toBe(PaymentStatus.PAID);
      expect(toAmountString(result.balance)).toBe('-500.00');
    });

    it('reads the ledger in date order, not insertion order', () => {
      // Payments are often entered days later, out of order.
      const result = settle(net, [payment('2500.00', 8), payment('1500.00', 1)]);

      expect(result.paidAt).toEqual(day(8));
    });
  });
});
