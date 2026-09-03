import { Injectable } from '@nestjs/common';
import { AppointmentStatus, Currency } from '@prisma/client';
import { CLINIC_TIMEZONE } from '../briefing/briefing';
import { parseCostItems } from '../finance/cost-items';
import { rateDayOf, type Rate } from '../finance/exchange';
import { ZERO, round, toAmountString, type Money } from '../finance/money';
import {
  toTotalsView,
  totalise,
  type Convertible,
  type TotalsView,
} from '../finance/totals';
import { PrismaService } from '../infra/prisma.service';
import {
  MIN_FOR_RATE,
  availableMinutesIn,
  groupByFolded,
  monthKey,
  monthOf,
  monthsBetween,
  occupancyOf,
  rateOf,
  type Occupancy,
} from './analytics';

/**
 * The clinic dashboard (spec M11, T6.4).
 *
 * Every figure here is a count or a sum over data the rest of the system
 * already keeps; nothing is estimated and no model is consulted. What the
 * module spends its effort on is the two ways a dashboard misleads:
 *
 *   * a **ratio without its denominator** — see `rateOf`, which returns null
 *     rather than a percentage when there are too few cases;
 *   * a **total that quietly excludes what it could not convert** — see
 *     `totalise`, whose `unconverted` list is carried all the way to the
 *     screen.
 */

export interface MonthlyCount {
  month: string;
  count: number;
}

export interface NamedCount {
  label: string;
  count: number;
  /** Of the total in range. Null when the total is too small to divide. */
  share: number | null;
}

export interface ProcedureReport {
  from: Date;
  to: Date;
  total: number;
  byMonth: MonthlyCount[];
  byProcedure: NamedCount[];
}

export interface GeographyReport {
  from: Date;
  to: Date;
  total: number;
  byCountry: NamedCount[];
  byCity: NamedCount[];
  /** Patients with no city recorded. Counted, so the shares add up. */
  cityUnknown: number;
}

export interface ChannelRow {
  /** The clinic's own spelling, the one used most often. */
  label: string;
  key: string;
  patients: number;
  /** Patients from this channel who went on to have an operation. */
  converted: number;
  conversionRate: number | null;
  /** Present only for a caller who may see money. */
  revenue?: TotalsView;
}

export interface ChannelReport {
  from: Date;
  to: Date;
  total: number;
  channels: ChannelRow[];
  /**
   * True when the caller may not see money, so the revenue columns are absent.
   *
   * Said out loud rather than left as a missing field: an absent revenue
   * column reads as "no revenue", which is a different and much worse claim.
   */
  revenueWithheld: boolean;
  /** What "converted" means here, so two readers cannot mean two things. */
  conversionDefinition: string;
  minimumForRate: number;
}

export interface RevenueReport {
  from: Date;
  to: Date;
  currency: Currency;
  /** Billed in the period, at each bill's own date. */
  gross: TotalsView;
  discount: TotalsView;
  net: TotalsView;
  /** What the cases cost, from the cost lines on the bills. */
  cost: TotalsView;
  agencyCommission: TotalsView;
  /** Net less costs and commission. */
  margin: TotalsView;
  byMonth: { month: string; net: string; converted: boolean }[];
  /** Exact, per currency: an average blended across currencies is a fiction. */
  averageByCurrency: { currency: Currency; average: string; count: number }[];
  recordCount: number;
  /** Cancelled bills are excluded; this says how many. */
  cancelledExcluded: number;
  /**
   * Cost lines that could not be read.
   *
   * Non-zero means the margin is missing something, and a margin missing
   * something is worse than no margin at all.
   */
  unreadableCostLines: number;
}

export interface OccupancyReport {
  from: Date;
  to: Date;
  byMonth: (Occupancy & { month: string; appointments: number })[];
  /**
   * True when no availability window is configured at all.
   *
   * The whole report is meaningless in that case, and the client must say so
   * rather than draw an empty chart.
   */
  capacityUnconfigured: boolean;
}

const CONVERSION_DEFINITION =
  'A patient counted as converted has at least one recorded operation. Enquiries are counted from the day their file was opened.';

const BOOKED: AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.COMPLETED,
];

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Operations by month and by type (spec M11). */
  async procedures(from: Date, to: Date, timezone = CLINIC_TIMEZONE): Promise<ProcedureReport> {
    const surgeries = await this.prisma.surgery.findMany({
      where: { performedAt: { gte: from, lte: to }, patient: { deletedAt: null } },
      select: { procedureName: true, performedAt: true },
    });

    const byMonth = new Map<string, number>();

    // Every month in range, including the empty ones: a chart that omits a
    // quiet August draws a straight line through it.
    for (const month of monthsBetween(from, to, timezone)) {
      byMonth.set(monthKey(month), 0);
    }

    for (const surgery of surgeries) {
      const key = monthKey(monthOf(surgery.performedAt, timezone));
      byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
    }

    const grouped = groupByFolded(surgeries, (surgery) => surgery.procedureName);

    return {
      from,
      to,
      total: surgeries.length,
      byMonth: [...byMonth.entries()].map(([month, count]) => ({ month, count })),
      byProcedure: this.ranked(grouped, surgeries.length),
    };
  }

  /** Where patients come from (spec M11: ülke bazlı dağılım, şehir kırılımı). */
  async geography(from: Date, to: Date): Promise<GeographyReport> {
    const patients = await this.prisma.patient.findMany({
      where: { createdAt: { gte: from, lte: to }, deletedAt: null },
      select: { country: true, city: true },
    });

    const byCountry = groupByFolded(patients, (patient) => patient.country);
    const withCity = patients.filter((patient) => (patient.city ?? '').trim() !== '');
    const byCity = groupByFolded(withCity, (patient) => patient.city);

    return {
      from,
      to,
      total: patients.length,
      byCountry: this.ranked(byCountry, patients.length),
      byCity: this.ranked(byCity, withCity.length),
      cityUnknown: patients.length - withCity.length,
    };
  }

  /**
   * Which channels bring patients, and what they are worth (spec M11).
   *
   * @param includeRevenue whether the caller holds `finance.report`. Money is
   * not shown to somebody who may not see money, and its absence is announced.
   */
  async channels(
    from: Date,
    to: Date,
    includeRevenue: boolean,
    currency: Currency = Currency.TRY,
    timezone = CLINIC_TIMEZONE,
  ): Promise<ChannelReport> {
    const patients = await this.prisma.patient.findMany({
      where: { createdAt: { gte: from, lte: to }, deletedAt: null },
      select: {
        id: true,
        referralSource: true,
        // Whether they ever had an operation, not only one inside the window:
        // a patient who enquired in March and was operated on in June still
        // converted, and cutting it at the window would understate every
        // recent channel.
        surgeries: { select: { id: true }, take: 1 },
      },
    });

    const grouped = groupByFolded(patients, (patient) => patient.referralSource);

    const revenueByPatient = includeRevenue
      ? await this.netByPatient(
          patients.map((patient) => patient.id),
          timezone,
        )
      : new Map<string, Convertible[]>();

    const rates = includeRevenue ? await this.ratesFor(from, to) : [];

    const channels: ChannelRow[] = [...grouped.entries()]
      .map(([key, group]) => {
        const converted = group.items.filter((patient) => patient.surgeries.length > 0).length;

        const row: ChannelRow = {
          key,
          label: key === 'unknown' ? 'unknown' : group.label,
          patients: group.items.length,
          converted,
          conversionRate: rateOf(converted, group.items.length),
        };

        if (includeRevenue) {
          const amounts = group.items.flatMap(
            (patient) => revenueByPatient.get(patient.id) ?? [],
          );
          row.revenue = toTotalsView(totalise(amounts, currency, rates));
        }

        return row;
      })
      .sort((a, b) => b.patients - a.patients || a.label.localeCompare(b.label));

    return {
      from,
      to,
      total: patients.length,
      channels,
      revenueWithheld: !includeRevenue,
      conversionDefinition: CONVERSION_DEFINITION,
      minimumForRate: MIN_FOR_RATE,
    };
  }

  /**
   * Money billed in a period, and what it cost (spec M11: gelir–gider).
   *
   * Counted on the day the bill was raised, and converted at that day's rate —
   * the same rule as the outstanding report, so the two cannot disagree. What
   * was *collected* is a different question and a different report
   * (`/finance/collections`).
   */
  async revenue(
    from: Date,
    to: Date,
    currency: Currency = Currency.TRY,
    timezone = CLINIC_TIMEZONE,
  ): Promise<RevenueReport> {
    const rows = await this.prisma.financeRecord.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: {
        currency: true,
        grossAmount: true,
        discount: true,
        netAmount: true,
        agencyCommission: true,
        costItems: true,
        createdAt: true,
        cancelledAt: true,
      },
    });

    // A cancelled bill is not revenue, and the count is reported so the figure
    // can be reconciled against the record list.
    const live = rows.filter((row) => row.cancelledAt === null);
    const rates = await this.ratesFor(from, to);

    const at = (row: (typeof live)[number]): string => rateDayOf(row.createdAt, timezone);

    const costs = live.map((row) => parseCostItems(row.costItems));
    const unreadableCostLines = costs.reduce((sum, parsed) => sum + parsed.unreadable, 0);

    const items = (pick: (index: number) => Money): Convertible[] =>
      live.map((row, index) => ({ currency: row.currency, amount: pick(index), on: at(row) }));

    const gross = items((i) => live[i]!.grossAmount);
    const discount = items((i) => live[i]!.discount);
    const net = items((i) => live[i]!.netAmount);
    const cost = items((i) => costs[i]!.total);
    const commission = items((i) => live[i]!.agencyCommission ?? ZERO);
    const margin = items((i) =>
      round(live[i]!.netAmount.minus(costs[i]!.total).minus(live[i]!.agencyCommission ?? ZERO)),
    );

    const byMonth = new Map<string, Convertible[]>();
    for (const month of monthsBetween(from, to, timezone)) byMonth.set(monthKey(month), []);
    for (const [index, row] of live.entries()) {
      const key = monthKey(monthOf(row.createdAt, timezone));
      byMonth.set(key, [...(byMonth.get(key) ?? []), net[index]!]);
    }

    return {
      from,
      to,
      currency,
      gross: toTotalsView(totalise(gross, currency, rates)),
      discount: toTotalsView(totalise(discount, currency, rates)),
      net: toTotalsView(totalise(net, currency, rates)),
      cost: toTotalsView(totalise(cost, currency, rates)),
      agencyCommission: toTotalsView(totalise(commission, currency, rates)),
      margin: toTotalsView(totalise(margin, currency, rates)),
      byMonth: [...byMonth.entries()].map(([month, amounts]) => {
        const totals = totalise(amounts, currency, rates);
        return {
          month,
          net: toAmountString(totals.converted),
          // Per point, so a chart can mark the month it could not fully convert
          // instead of drawing a dip that never happened.
          converted: totals.complete,
        };
      }),
      averageByCurrency: this.averages(live),
      recordCount: live.length,
      cancelledExcluded: rows.length - live.length,
      unreadableCostLines,
    };
  }

  /**
   * How full the diary is (spec M11: randevu doluluk oranı).
   *
   * Booked minutes over configured working minutes, in the clinic's wall clock.
   * With no availability window on file there is no denominator at all, and the
   * report says so rather than drawing nought per cent — which would read as an
   * empty diary rather than a missing setting.
   */
  async occupancy(from: Date, to: Date, timezone = CLINIC_TIMEZONE): Promise<OccupancyReport> {
    const [appointments, windows] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          scheduledAt: { gte: from, lte: to },
          status: { in: BOOKED },
          patient: { deletedAt: null },
        },
        select: { scheduledAt: true, durationMinutes: true },
      }),
      this.prisma.availabilityWindow.findMany({
        where: { isActive: true },
        select: { dayOfWeek: true, startTime: true, endTime: true },
      }),
    ]);

    const booked = new Map<string, { minutes: number; count: number }>();
    const months = monthsBetween(from, to, timezone);

    for (const month of months) booked.set(monthKey(month), { minutes: 0, count: 0 });

    for (const appointment of appointments) {
      const key = monthKey(monthOf(appointment.scheduledAt, timezone));
      const bucket = booked.get(key) ?? { minutes: 0, count: 0 };

      bucket.minutes += appointment.durationMinutes;
      bucket.count += 1;
      booked.set(key, bucket);
    }

    return {
      from,
      to,
      byMonth: months.map((month) => {
        const key = monthKey(month);
        const bucket = booked.get(key) ?? { minutes: 0, count: 0 };

        return {
          month: key,
          ...occupancyOf(bucket.minutes, availableMinutesIn(month, windows)),
          appointments: bucket.count,
        };
      }),
      capacityUnconfigured: windows.length === 0,
    };
  }

  // --------------------------------------------------------------- internals

  private ranked<T>(
    groups: Map<string, { label: string; items: T[] }>,
    total: number,
  ): NamedCount[] {
    return [...groups.values()]
      .map((group) => ({
        label: group.label,
        count: group.items.length,
        share: rateOf(group.items.length, total),
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  private averages(
    rows: { currency: Currency; netAmount: Money }[],
  ): { currency: Currency; average: string; count: number }[] {
    const byCurrency = new Map<Currency, { total: Money; count: number }>();

    for (const row of rows) {
      const bucket = byCurrency.get(row.currency) ?? { total: ZERO, count: 0 };

      byCurrency.set(row.currency, {
        total: bucket.total.plus(row.netAmount),
        count: bucket.count + 1,
      });
    }

    return [...byCurrency.entries()]
      .map(([currency, bucket]) => ({
        currency,
        average: toAmountString(round(bucket.total.div(bucket.count))),
        count: bucket.count,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /** Net billed per patient, each amount tagged with the day it converts at. */
  private async netByPatient(
    patientIds: string[],
    timezone: string,
  ): Promise<Map<string, Convertible[]>> {
    if (patientIds.length === 0) return new Map();

    const rows = await this.prisma.financeRecord.findMany({
      where: { patientId: { in: patientIds }, cancelledAt: null },
      select: { patientId: true, currency: true, netAmount: true, createdAt: true },
    });

    const byPatient = new Map<string, Convertible[]>();

    for (const row of rows) {
      byPatient.set(row.patientId, [
        ...(byPatient.get(row.patientId) ?? []),
        {
          currency: row.currency,
          amount: row.netAmount,
          on: rateDayOf(row.createdAt, timezone),
        },
      ]);
    }

    return byPatient;
  }

  private async ratesFor(from: Date, to: Date): Promise<Rate[]> {
    const earliest = new Date(from.getTime() - 30 * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.exchangeRate.findMany({
      where: { validOn: { gte: earliest, lte: to } },
      orderBy: { validOn: 'desc' },
    });

    return rows.map((row) => ({
      base: row.base,
      quote: row.quote,
      rate: row.rate,
      validOn: row.validOn,
    }));
  }
}
