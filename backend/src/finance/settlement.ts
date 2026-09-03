import { PaymentKind, PaymentStatus } from '@prisma/client';
import { ZERO, round, type Money } from './money';

/**
 * What the ledger says about a bill (spec M11).
 *
 * The payment status is **derived here and nowhere else**. It is not a field a
 * client may set, because a status somebody can type is a status that can
 * disagree with the money: a bill marked PAID with nothing collected against it
 * drops out of the receivables report and is never chased again, and nothing in
 * the system would show that anything was wrong.
 *
 * The one state the amounts cannot imply is cancellation — a bill that was
 * written off or a treatment that did not happen — so that is the one a human
 * sets, and it is a date rather than a status so the record says when.
 */

export interface LedgerEntry {
  kind: PaymentKind;
  /** In the bill's currency. */
  appliedAmount: Money;
  paidAt: Date;
  /** A correction. The row stays; it stops counting. */
  reversedAt: Date | null;
}

export interface Settlement {
  /** Payments less refunds, ignoring reversed rows. */
  paid: Money;
  /** Still owed. Negative when the patient has overpaid. */
  balance: Money;
  status: PaymentStatus;
  /** When it became fully paid, or null while anything is outstanding. */
  paidAt: Date | null;
  /** Refunded money, kept separate: it is not a payment that did not happen. */
  refunded: Money;
}

function counts(entry: LedgerEntry): boolean {
  return entry.reversedAt === null;
}

export function settle(
  net: Money,
  entries: LedgerEntry[],
  cancelledAt: Date | null = null,
): Settlement {
  const live = entries.filter(counts);

  let received = ZERO;
  let refunded = ZERO;

  for (const entry of live) {
    if (entry.kind === PaymentKind.REFUND) refunded = refunded.plus(entry.appliedAmount);
    else received = received.plus(entry.appliedAmount);
  }

  const paid = round(received.minus(refunded));
  const balance = round(net.minus(paid));

  return {
    paid,
    refunded: round(refunded),
    balance,
    status: statusOf(net, paid, refunded, cancelledAt),
    paidAt: settledAt(net, live),
  };
}

function statusOf(
  net: Money,
  paid: Money,
  refunded: Money,
  cancelledAt: Date | null,
): PaymentStatus {
  if (cancelledAt !== null) return PaymentStatus.CANCELLED;

  if (paid.lte(ZERO)) {
    // Money that came in and went back out is not the same thing as money that
    // never arrived, and a collection report that cannot tell them apart will
    // send someone to chase a patient who has already been refunded.
    if (refunded.gt(ZERO)) return PaymentStatus.REFUNDED;

    // A complimentary procedure owes nothing, so it is not outstanding.
    return net.isZero() ? PaymentStatus.PAID : PaymentStatus.PENDING;
  }

  return paid.lt(net) ? PaymentStatus.PARTIAL : PaymentStatus.PAID;
}

/**
 * The moment the bill was settled, in the ledger's own order.
 *
 * Walked rather than taken as the latest payment date, because a refund can
 * push a settled bill back into debt and a later payment settle it again — and
 * the date that belongs on the record is the one it has been settled since,
 * not the first time it happened to be covered.
 */
function settledAt(net: Money, entries: LedgerEntry[]): Date | null {
  const inOrder = [...entries].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());

  let running = ZERO;
  let crossedAt: Date | null = null;

  for (const entry of inOrder) {
    running =
      entry.kind === PaymentKind.REFUND
        ? running.minus(entry.appliedAmount)
        : running.plus(entry.appliedAmount);

    if (running.gte(net)) {
      crossedAt ??= entry.paidAt;
    } else {
      crossedAt = null;
    }
  }

  // A bill of nothing with no payments against it was never "settled" on a
  // particular day, so it gets no date rather than an invented one.
  return crossedAt;
}
