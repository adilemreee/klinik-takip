import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  Currency,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CLINIC_TIMEZONE } from '../briefing/briefing';
import { PrismaService } from '../infra/prisma.service';
import type { RequestContext } from '../patients/patients.service';
import { dayToDate, rateDay, rateDayOf, type Rate } from './exchange';
import { ZERO, money, requirePositive, round, toAmountString, type Money } from './money';
import { settle } from './settlement';
import { totalise, type Convertible, type Totals } from './totals';

/**
 * Finance records, payments and the collection report (spec M11, T6.3).
 *
 * Three rules shape everything here.
 *
 * **Access is clinic-wide, and only to money.** You cannot do the books on a
 * subset of the books, so anyone holding `finance.read` sees every record —
 * which is why the FINANCE role has no clinical access at all (spec section 2)
 * and why the patient block on a finance record carries a name, a file number
 * and a country and nothing else. No diagnosis, no procedure history, no notes.
 *
 * **The status is derived.** `paymentStatus`, `paidAmount` and `paidAt` are
 * recomputed from the payment ledger inside the same transaction as the
 * payment, and no endpoint accepts them. See `settlement.ts`.
 *
 * **Nothing is deleted.** A mistyped payment is reversed, and the original row
 * stays with its original numbers.
 *
 * There is no payment gateway here and there is not meant to be: the
 * specification puts virtual POS integration out of scope. This module records
 * money the clinic has collected; it never moves any.
 */

export interface FinancePatient {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  country: string;
}

export interface PaymentView {
  id: string;
  kind: PaymentKind;
  /** Amounts are strings everywhere: a JSON number is a double by the time a client has it. */
  amount: string;
  currency: Currency;
  appliedAmount: string;
  rate: string | null;
  method: PaymentMethod;
  paidAt: Date;
  reference: string | null;
  note: string | null;
  reversedAt: Date | null;
  reversalReason: string | null;
}

export interface FinanceRecordView {
  id: string;
  patientId: string;
  patient: FinancePatient | null;
  procedureName: string;
  currency: Currency;
  grossAmount: string;
  discount: string;
  netAmount: string;
  paidAmount: string;
  refundedAmount: string;
  /** Still owed. Negative when the patient has overpaid. */
  balance: string;
  paymentStatus: PaymentStatus;
  paidAt: Date | null;
  cancelledAt: Date | null;
  agencyId: string | null;
  agencyName: string | null;
  agencyCommission: string | null;
  costItems: Prisma.JsonValue | null;
  note: string | null;
  payments: PaymentView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRecordInput {
  procedureName: string;
  currency: Currency;
  grossAmount: string;
  discount?: string;
  costItems?: Record<string, unknown>;
  agencyId?: string;
  /** Overrides the agency's standing rate for a negotiated case. */
  agencyCommission?: string;
  note?: string;
}

export interface UpdateRecordInput {
  procedureName?: string;
  grossAmount?: string;
  discount?: string;
  costItems?: Record<string, unknown>;
  agencyId?: string | null;
  agencyCommission?: string | null;
  note?: string;
}

export interface RecordPaymentInput {
  amount: string;
  currency?: Currency;
  /** Required when the payment currency differs from the bill's. */
  appliedAmount?: string;
  method: PaymentMethod;
  paidAt?: Date;
  reference?: string;
  note?: string;
  kind?: PaymentKind;
}

export interface ListRecordsQuery {
  patientId?: string;
  status?: PaymentStatus;
  currency?: Currency;
  agencyId?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
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

export interface CollectionReport {
  from: Date;
  to: Date;
  currency: Currency;
  /** Money in, before refunds. */
  received: TotalsView;
  refunded: TotalsView;
  /** Received less refunded. The number a collection report is asked for. */
  net: TotalsView;
  byMethod: { method: PaymentMethod; totals: TotalsView }[];
  paymentCount: number;
}

export interface AgencyView {
  id: string;
  name: string;
  country: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  commissionRate: string | null;
  isActive: boolean;
}

export interface OutstandingReport {
  currency: Currency;
  /** Billed but not collected, excluding cancelled bills. */
  outstanding: TotalsView;
  /** How long it has been owed, from the day the bill was raised. */
  ageing: { bucket: AgeingBucket; totals: TotalsView; recordCount: number }[];
  recordCount: number;
}

/** Days since the bill was raised: 0-29, 30-59, 60-89, 90 and over. */
export type AgeingBucket = 'current' | 'd30' | 'd60' | 'over90';

const AGEING: { bucket: AgeingBucket; fromDays: number; toDays: number | null }[] = [
  { bucket: 'current', fromDays: 0, toDays: 30 },
  { bucket: 'd30', fromDays: 30, toDays: 60 },
  { bucket: 'd60', fromDays: 60, toDays: 90 },
  { bucket: 'over90', fromDays: 90, toDays: null },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const RECORD_INCLUDE = {
  payments: { orderBy: { paidAt: 'asc' } },
  patient: { select: { id: true, mrn: true, firstName: true, lastName: true, country: true } },
  agency: { select: { id: true, name: true, commissionRate: true } },
} satisfies Prisma.FinanceRecordInclude;

type RecordRow = Prisma.FinanceRecordGetPayload<{ include: typeof RECORD_INCLUDE }>;

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- records

  async create(
    user: AuthenticatedUser,
    patientId: string,
    input: CreateRecordInput,
    context: RequestContext = {},
  ): Promise<FinanceRecordView> {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { id: true },
    });

    if (!patient) throw new NotFoundException('Patient not found');

    const amounts = this.amountsOf(input.grossAmount, input.discount);
    const commission =
      input.agencyCommission !== undefined
        ? this.explicitCommission(input.agencyCommission)
        : await this.commissionFor(input.agencyId ?? null, amounts.net);

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.financeRecord.create({
        data: {
          patientId,
          procedureName: input.procedureName,
          currency: input.currency,
          grossAmount: amounts.gross,
          discount: amounts.discount,
          netAmount: amounts.net,
          costItems: input.costItems as Prisma.InputJsonValue | undefined,
          agencyId: input.agencyId,
          agencyCommission: commission,
          note: input.note,
          // Derived, and stated here only because the columns are not nullable.
          paymentStatus: amounts.net.isZero() ? PaymentStatus.PAID : PaymentStatus.PENDING,
          paidAmount: ZERO,
        },
        include: RECORD_INCLUDE,
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.CREATE,
        entityType: 'finance_records',
        entityId: row.id,
        patientId,
        after: {
          currency: row.currency,
          grossAmount: toAmountString(row.grossAmount),
          netAmount: toAmountString(row.netAmount),
        },
        ...context,
      });

      return row;
    });

    return this.view(created);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateRecordInput,
    context: RequestContext = {},
  ): Promise<FinanceRecordView> {
    const existing = await this.mustFind(id);

    if (existing.cancelledAt !== null) {
      throw new ConflictException('A cancelled record cannot be edited');
    }

    const gross = input.grossAmount ?? toAmountString(existing.grossAmount);
    const discount = input.discount ?? toAmountString(existing.discount);
    const amounts = this.amountsOf(gross, discount);

    const agencyId = input.agencyId === undefined ? existing.agencyId : input.agencyId;

    // Recomputed only when something it depends on moved. Otherwise a
    // negotiated commission entered by hand would be silently overwritten by
    // the agency's standing rate the next time somebody fixed a typo in the
    // procedure name.
    const amountsChanged =
      input.grossAmount !== undefined ||
      input.discount !== undefined ||
      input.agencyId !== undefined;

    const commission =
      input.agencyCommission !== undefined
        ? this.explicitCommission(input.agencyCommission)
        : amountsChanged
          ? await this.commissionFor(agencyId, amounts.net)
          : existing.agencyCommission;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.financeRecord.update({
        where: { id },
        data: {
          procedureName: input.procedureName,
          grossAmount: amounts.gross,
          discount: amounts.discount,
          netAmount: amounts.net,
          costItems: input.costItems as Prisma.InputJsonValue | undefined,
          agencyId,
          agencyCommission: commission,
          note: input.note,
        },
        include: RECORD_INCLUDE,
      });

      // Changing the bill changes whether it is paid: a discount applied after
      // a deposit can settle it outright, and leaving the old status behind
      // would keep chasing money that is no longer owed.
      const settled = await this.resettle(tx, row);

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'finance_records',
        entityId: id,
        patientId: existing.patientId,
        before: {
          grossAmount: toAmountString(existing.grossAmount),
          discount: toAmountString(existing.discount),
          netAmount: toAmountString(existing.netAmount),
        },
        after: {
          grossAmount: toAmountString(amounts.gross),
          discount: toAmountString(amounts.discount),
          netAmount: toAmountString(amounts.net),
          paymentStatus: settled.paymentStatus,
        },
        ...context,
      });

      return settled;
    });

    return this.view(updated);
  }

  /**
   * Writing a bill off, or recording that the treatment did not happen.
   *
   * Not a delete. The record stays visible with its payments, because money
   * that was collected against a cancelled bill still has to be accounted for
   * — and usually refunded.
   */
  async cancel(
    user: AuthenticatedUser,
    id: string,
    reason: string,
    context: RequestContext = {},
  ): Promise<FinanceRecordView> {
    const existing = await this.mustFind(id);

    if (existing.cancelledAt !== null) return this.view(existing);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.financeRecord.update({
        where: { id },
        data: {
          cancelledAt: new Date(),
          paymentStatus: PaymentStatus.CANCELLED,
          note: existing.note ? `${existing.note}\n${reason}` : reason,
        },
        include: RECORD_INCLUDE,
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'finance_records',
        entityId: id,
        patientId: existing.patientId,
        before: { paymentStatus: existing.paymentStatus },
        after: { paymentStatus: PaymentStatus.CANCELLED, reason },
        ...context,
      });

      return row;
    });

    return this.view(updated);
  }

  async get(id: string): Promise<FinanceRecordView> {
    return this.view(await this.mustFind(id));
  }

  async forPatient(patientId: string): Promise<FinanceRecordView[]> {
    const rows = await this.prisma.financeRecord.findMany({
      where: { patientId },
      include: RECORD_INCLUDE,
      orderBy: { id: 'desc' },
    });

    return rows.map((row) => this.view(row));
  }

  async list(
    query: ListRecordsQuery,
  ): Promise<{ items: FinanceRecordView[]; nextCursor: string | null }> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const rows = await this.prisma.financeRecord.findMany({
      where: {
        patientId: query.patientId,
        paymentStatus: query.status,
        currency: query.currency,
        agencyId: query.agencyId,
        createdAt:
          query.from || query.to ? { gte: query.from, lte: query.to } : undefined,
      },
      include: RECORD_INCLUDE,
      // UUIDv7, so this is newest-first with a stable cursor.
      orderBy: { id: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => this.view(row));

    return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
  }

  // --------------------------------------------------------------- payments

  /**
   * Recording money that arrived (spec M11: peşin/taksit).
   *
   * A payment in a currency other than the bill's has to say what it settled,
   * because the rate that settles a bill is the one the bank actually used that
   * day. Looking one up here would mean the software decided, from a table it
   * cannot verify, whether a patient still owes money.
   */
  async addPayment(
    user: AuthenticatedUser,
    recordId: string,
    input: RecordPaymentInput,
    context: RequestContext = {},
  ): Promise<FinanceRecordView> {
    const record = await this.mustFind(recordId);

    if (record.cancelledAt !== null) {
      throw new ConflictException('A cancelled record cannot take a payment');
    }

    const currency = input.currency ?? record.currency;
    const amount = requirePositive(input.amount, 'amount');

    let applied: Money;
    let rate: Money | null = null;

    if (currency === record.currency) {
      if (input.appliedAmount !== undefined && !money(input.appliedAmount).equals(amount)) {
        throw new BadRequestException(
          'A payment in the record currency settles its own amount',
        );
      }
      applied = amount;
    } else {
      if (input.appliedAmount === undefined) {
        throw new BadRequestException(
          `A payment in ${currency} against a ${record.currency} record must say how much of the bill it settles`,
        );
      }
      applied = requirePositive(input.appliedAmount, 'appliedAmount');
      // Kept at the column's precision. Rounding a rate to two places is
      // how a reconciliation ends up a few lira out on every transfer.
      rate = applied.div(amount).toDecimalPlaces(8);
    }

    const paidAt = input.paidAt ?? new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          financeRecordId: recordId,
          kind: input.kind ?? PaymentKind.PAYMENT,
          amount,
          currency,
          appliedAmount: applied,
          rate,
          method: input.method,
          paidAt,
          reference: input.reference,
          note: input.note,
          recordedById: user.id,
        },
      });

      const row = await this.resettle(tx, recordId);

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.CREATE,
        entityType: 'payments',
        entityId: payment.id,
        patientId: record.patientId,
        after: {
          amount: toAmountString(amount),
          currency,
          appliedAmount: toAmountString(applied),
          method: input.method,
          paymentStatus: row.paymentStatus,
        },
        ...context,
      });

      return row;
    });

    return this.view(updated);
  }

  /**
   * Undoing a mistyped payment.
   *
   * The row is marked reversed rather than deleted, and keeps its original
   * amount: "this was entered and then corrected" and "this never happened" are
   * different facts, and only one of them can be reconciled against a bank
   * statement.
   */
  async reversePayment(
    user: AuthenticatedUser,
    paymentId: string,
    reason: string,
    context: RequestContext = {},
  ): Promise<FinanceRecordView> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { financeRecord: { select: { id: true, patientId: true } } },
    });

    if (!payment) throw new NotFoundException('Payment not found');

    if (payment.reversedAt !== null) {
      throw new ConflictException('This payment has already been reversed');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { reversedAt: new Date(), reversedById: user.id, reversalReason: reason },
      });

      const row = await this.resettle(tx, payment.financeRecordId);

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'payments',
        entityId: paymentId,
        patientId: payment.financeRecord.patientId,
        before: { appliedAmount: toAmountString(payment.appliedAmount), reversedAt: null },
        after: { reversed: true, reason, paymentStatus: row.paymentStatus },
        ...context,
      });

      return row;
    });

    return this.view(updated);
  }

  // ---------------------------------------------------------------- reports

  /**
   * Money actually received in a period (spec M11: tahsilat raporu).
   *
   * Read off the payment ledger and not off the bills, because a bill tells you
   * what was agreed and a payment tells you what arrived. Each payment converts
   * at the rate of the day it arrived.
   */
  async collections(
    from: Date,
    to: Date,
    currency: Currency,
    timezone = CLINIC_TIMEZONE,
  ): Promise<CollectionReport> {
    const payments = await this.prisma.payment.findMany({
      where: { paidAt: { gte: from, lte: to }, reversedAt: null },
      select: { kind: true, amount: true, currency: true, paidAt: true, method: true },
    });

    const rates = await this.ratesFor(from, to);

    const asItem = (payment: (typeof payments)[number]): Convertible => ({
      currency: payment.currency,
      amount: payment.amount,
      on: rateDayOf(payment.paidAt, timezone),
    });

    const received = payments.filter((p) => p.kind === PaymentKind.PAYMENT);
    const refunded = payments.filter((p) => p.kind === PaymentKind.REFUND);

    const signed = payments.map((payment) => ({
      ...asItem(payment),
      amount:
        payment.kind === PaymentKind.REFUND ? payment.amount.negated() : payment.amount,
      method: payment.method,
    }));

    const methods = [...new Set(payments.map((payment) => payment.method))].sort();

    return {
      from,
      to,
      currency,
      received: this.totalsView(totalise(received.map(asItem), currency, rates)),
      refunded: this.totalsView(totalise(refunded.map(asItem), currency, rates)),
      net: this.totalsView(totalise(signed, currency, rates)),
      byMethod: methods.map((method) => ({
        method,
        totals: this.totalsView(
          totalise(
            signed.filter((payment) => payment.method === method),
            currency,
            rates,
          ),
        ),
      })),
      paymentCount: payments.length,
    };
  }

  /**
   * What is still owed, and for how long.
   *
   * Each bill converts at the day it was raised rather than today's rate, so an
   * ageing report does not change its own history every time the lira moves.
   * What the clinic is owed is what it billed.
   */
  async outstanding(
    currency: Currency,
    now = new Date(),
    timezone = CLINIC_TIMEZONE,
  ): Promise<OutstandingReport> {
    const rows = await this.prisma.financeRecord.findMany({
      where: {
        cancelledAt: null,
        paymentStatus: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] },
      },
      select: {
        id: true,
        currency: true,
        netAmount: true,
        paidAmount: true,
        createdAt: true,
      },
    });

    const oldest = rows.reduce<Date>(
      (earliest, row) => (row.createdAt < earliest ? row.createdAt : earliest),
      now,
    );
    const rates = await this.ratesFor(oldest, now);

    const items = rows.map((row) => ({
      currency: row.currency,
      amount: round(row.netAmount.minus(row.paidAmount)),
      on: rateDayOf(row.createdAt, timezone),
      ageDays: Math.floor((now.getTime() - row.createdAt.getTime()) / DAY_MS),
    }));

    // Only debts. An overpaid bill is not a receivable, and letting a negative
    // balance net off someone else's debt would hide it.
    const owed = items.filter((item) => item.amount.gt(ZERO));

    return {
      currency,
      outstanding: this.totalsView(totalise(owed, currency, rates)),
      ageing: AGEING.map(({ bucket, fromDays, toDays }) => {
        const inBucket = owed.filter(
          (item) => item.ageDays >= fromDays && (toDays === null || item.ageDays < toDays),
        );

        return {
          bucket,
          totals: this.totalsView(totalise(inBucket, currency, rates)),
          recordCount: inBucket.length,
        };
      }),
      recordCount: owed.length,
    };
  }

  // ------------------------------------------------------------------ rates

  /**
   * Recording a rate.
   *
   * There is no rate feed in this repository. Where the numbers come from —
   * the central bank, the clinic's own bank, a negotiated rate with an agency —
   * is the clinic's decision, and a made-up source would be worse than none.
   */
  async putRate(
    user: AuthenticatedUser,
    base: Currency,
    quote: Currency,
    rate: string,
    validOn: string,
  ): Promise<Rate> {
    if (base === quote) {
      throw new BadRequestException('A currency does not need a rate against itself');
    }

    const value = requirePositiveRate(rate);
    const day = dayToDate(validOn);

    const row = await this.prisma.exchangeRate.upsert({
      where: { base_quote_validOn: { base, quote, validOn: day } },
      create: { base, quote, rate: value, validOn: day, recordedById: user.id },
      update: { rate: value, recordedById: user.id },
    });

    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.UPDATE,
      entityType: 'exchange_rates',
      entityId: row.id,
      after: { base, quote, rate: value.toString(), validOn },
    });

    return { base: row.base, quote: row.quote, rate: row.rate, validOn: row.validOn };
  }

  async listRates(from: Date, to: Date): Promise<Rate[]> {
    return this.ratesFor(from, to);
  }

  private async ratesFor(from: Date, to: Date): Promise<Rate[]> {
    // Reaching back past the window: a report for a Monday may legitimately
    // need the rate published the Friday before it.
    const earliest = dayToDate(rateDay(new Date(from.getTime() - 30 * DAY_MS)));

    const rows = await this.prisma.exchangeRate.findMany({
      where: { validOn: { gte: earliest, lte: dayToDate(rateDay(to)) } },
      orderBy: { validOn: 'desc' },
    });

    return rows.map((row) => ({
      base: row.base,
      quote: row.quote,
      rate: row.rate,
      validOn: row.validOn,
    }));
  }

  // --------------------------------------------------------------- agencies

  /**
   * Agencies exist here because commission does. Where a patient came *from* is
   * the analytics module's question (spec M11, T6.4); what the clinic owes for
   * them is this one's.
   */
  async listAgencies(includeInactive = false): Promise<AgencyView[]> {
    const rows = await this.prisma.agency.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
    });

    return rows.map((row) => this.agencyView(row));
  }

  async createAgency(
    user: AuthenticatedUser,
    input: {
      name: string;
      country?: string;
      contactName?: string;
      contactEmail?: string;
      contactPhone?: string;
      commissionRate?: string;
    },
  ): Promise<AgencyView> {
    const row = await this.prisma.agency.create({
      data: {
        name: input.name,
        country: input.country,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        commissionRate: input.commissionRate ? money(input.commissionRate) : null,
      },
    });

    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.CREATE,
      entityType: 'agencies',
      entityId: row.id,
      after: { name: row.name, commissionRate: row.commissionRate?.toString() ?? null },
    });

    return this.agencyView(row);
  }

  async updateAgency(
    user: AuthenticatedUser,
    id: string,
    input: {
      name?: string;
      country?: string;
      contactName?: string;
      contactEmail?: string;
      contactPhone?: string;
      commissionRate?: string;
      isActive?: boolean;
    },
  ): Promise<AgencyView> {
    const existing = await this.prisma.agency.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Agency not found');

    const row = await this.prisma.agency.update({
      where: { id },
      data: {
        name: input.name,
        country: input.country,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        commissionRate:
          input.commissionRate === undefined ? undefined : money(input.commissionRate),
        isActive: input.isActive,
      },
    });

    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.UPDATE,
      entityType: 'agencies',
      entityId: id,
      before: { name: existing.name, isActive: existing.isActive },
      after: { name: row.name, isActive: row.isActive },
    });

    return this.agencyView(row);
  }

  // --------------------------------------------------------------- internals

  private agencyView(row: {
    id: string;
    name: string;
    country: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    commissionRate: Money | null;
    isActive: boolean;
  }): AgencyView {
    return {
      id: row.id,
      name: row.name,
      country: row.country,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      commissionRate: row.commissionRate ? row.commissionRate.toString() : null,
      isActive: row.isActive,
    };
  }

  private totalsView(totals: Totals): TotalsView {
    return {
      currency: totals.currency,
      converted: toAmountString(totals.converted),
      byCurrency: totals.byCurrency.map((entry) => ({
        currency: entry.currency,
        amount: toAmountString(entry.amount),
      })),
      unconverted: totals.unconverted.map((entry) => ({
        currency: entry.currency,
        amount: toAmountString(entry.amount),
      })),
      complete: totals.complete,
    };
  }

  private amountsOf(
    gross: string | Money,
    discount: string | Money | undefined,
  ): { gross: Money; discount: Money; net: Money } {
    const grossAmount = requirePositive(gross, 'grossAmount', true);
    const discountAmount = requirePositive(discount ?? ZERO, 'discount', true);

    if (discountAmount.gt(grossAmount)) {
      throw new BadRequestException('Discount cannot exceed the gross amount');
    }

    // Computed, never supplied. A net that arrives from a client is a net that
    // can disagree with the two numbers it is made of.
    return {
      gross: grossAmount,
      discount: discountAmount,
      net: round(grossAmount.minus(discountAmount)),
    };
  }

  /** A commission the clinic typed in, which beats any standing rate. */
  private explicitCommission(value: string | null): Money | null {
    return value === null ? null : requirePositive(value, 'agencyCommission', true);
  }

  /** The agency's standing rate applied to the net. */
  private async commissionFor(agencyId: string | null, net: Money): Promise<Money | null> {
    if (agencyId === null) return null;

    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
      select: { commissionRate: true },
    });

    if (!agency) throw new NotFoundException('Agency not found');

    // An agency with no rate on file gets no commission rather than a
    // plausible-looking zero.
    return agency.commissionRate === null ? null : round(net.times(agency.commissionRate));
  }

  /**
   * Recomputes the derived columns from the ledger.
   *
   * The single place `paymentStatus`, `paidAmount` and `paidAt` are written,
   * and always in the same transaction as the change that moved them.
   */
  private async resettle(
    tx: Prisma.TransactionClient,
    recordOrId: string | RecordRow,
  ): Promise<RecordRow> {
    const id = typeof recordOrId === 'string' ? recordOrId : recordOrId.id;

    const record = await tx.financeRecord.findUniqueOrThrow({
      where: { id },
      include: RECORD_INCLUDE,
    });

    const settled = settle(record.netAmount, record.payments, record.cancelledAt);

    return tx.financeRecord.update({
      where: { id },
      data: {
        paidAmount: settled.paid,
        paymentStatus: settled.status,
        paidAt: settled.paidAt,
      },
      include: RECORD_INCLUDE,
    });
  }

  private async mustFind(id: string): Promise<RecordRow> {
    const row = await this.prisma.financeRecord.findUnique({
      where: { id },
      include: RECORD_INCLUDE,
    });

    if (!row) throw new NotFoundException('Finance record not found');

    return row;
  }

  private view(row: RecordRow): FinanceRecordView {
    const settled = settle(row.netAmount, row.payments, row.cancelledAt);

    return {
      id: row.id,
      patientId: row.patientId,
      // Name, file number, country. Nothing clinical: this is what the finance
      // desk needs to know whose bill it is (spec section 2).
      patient: row.patient
        ? {
            id: row.patient.id,
            mrn: row.patient.mrn,
            firstName: row.patient.firstName,
            lastName: row.patient.lastName,
            country: row.patient.country,
          }
        : null,
      procedureName: row.procedureName,
      currency: row.currency,
      grossAmount: toAmountString(row.grossAmount),
      discount: toAmountString(row.discount),
      netAmount: toAmountString(row.netAmount),
      paidAmount: toAmountString(settled.paid),
      refundedAmount: toAmountString(settled.refunded),
      balance: toAmountString(settled.balance),
      paymentStatus: settled.status,
      paidAt: settled.paidAt,
      cancelledAt: row.cancelledAt,
      agencyId: row.agencyId,
      agencyName: row.agency?.name ?? null,
      agencyCommission: row.agencyCommission ? toAmountString(row.agencyCommission) : null,
      costItems: row.costItems,
      note: row.note,
      payments: row.payments.map((payment) => ({
        id: payment.id,
        kind: payment.kind,
        amount: toAmountString(payment.amount),
        currency: payment.currency,
        appliedAmount: toAmountString(payment.appliedAmount),
        rate: payment.rate ? payment.rate.toString() : null,
        method: payment.method,
        paidAt: payment.paidAt,
        reference: payment.reference,
        note: payment.note,
        reversedAt: payment.reversedAt,
        reversalReason: payment.reversalReason,
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

function requirePositiveRate(value: string): Money {
  const rate = money(value);

  if (rate.lte(ZERO)) throw new BadRequestException('A rate must be greater than zero');

  return rate;
}
