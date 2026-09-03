import { Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { ZERO, toAmountString } from '../finance/money';
import { PrismaService } from '../infra/prisma.service';
import type { ColumnDefinition } from './columns';

/**
 * The rows of a bulk patient export (spec M12, T6.6).
 *
 * Read in pages and handed out one at a time, so a clinic with forty thousand
 * files does not have to fit in the worker's memory to produce a spreadsheet
 * of it.
 *
 * The scope filter is composed into the query rather than applied afterwards,
 * the same as everywhere else: filtering after the read is filtering that a
 * forgotten `count()` will eventually leak past.
 */

export interface PatientListFilter {
  from?: Date;
  to?: Date;
  country?: string;
  /** Matches a procedure name on any of the patient's surgeries. */
  procedure?: string;
  assignedDoctorId?: string;
  agencyId?: string;
}

const PAGE = 500;

/** A ceiling on one export, so a filter nobody meant cannot fill the disk. */
export const MAX_ROWS = 100_000;

@Injectable()
export class PatientListBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
  ) {}

  /** How many rows the filter matches, for the provenance block. */
  async count(user: AuthenticatedUser, filter: PatientListFilter): Promise<number> {
    return this.prisma.patient.count({ where: await this.where(user, filter) });
  }

  /**
   * Every matching row, a page at a time.
   *
   * @yields one array of cell values per patient, in the caller's column order.
   */
  async *rows(
    user: AuthenticatedUser,
    filter: PatientListFilter,
    columns: ColumnDefinition[],
  ): AsyncGenerator<unknown[]> {
    const where = await this.where(user, filter);
    const needsFinance = columns.some((column) => column.group === 'finance');
    const needsClinical = columns.some((column) => column.group === 'clinical');

    let cursor: string | undefined;
    let emitted = 0;

    while (emitted < MAX_ROWS) {
      const page = await this.prisma.patient.findMany({
        where,
        // UUIDv7, so this pages stably even while rows are being written.
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          assignedDoctor: { select: { firstName: true, lastName: true } },
          agency: { select: { name: true } },
          surgeries: needsClinical
            ? { select: { procedureName: true, performedAt: true }, orderBy: { performedAt: 'desc' } }
            : false,
          financeRecords: needsFinance
            ? {
                where: { cancelledAt: null },
                select: {
                  currency: true,
                  netAmount: true,
                  paidAmount: true,
                  paymentStatus: true,
                },
              }
            : false,
        },
      });

      if (page.length === 0) return;

      for (const patient of page) {
        yield columns.map((column) => this.cell(column.key, patient as PatientRow));

        emitted += 1;
        if (emitted >= MAX_ROWS) return;
      }

      cursor = page[page.length - 1]!.id;
      if (page.length < PAGE) return;
    }
  }

  private async where(
    user: AuthenticatedUser,
    filter: PatientListFilter,
  ): Promise<Prisma.PatientWhereInput> {
    const scope = await this.access.scopeFilter(user);
    const conditions: Prisma.PatientWhereInput[] = [scope];

    if (filter.from || filter.to) {
      conditions.push({ createdAt: { gte: filter.from, lte: filter.to } });
    }
    if (filter.country) conditions.push({ country: filter.country });
    if (filter.assignedDoctorId) conditions.push({ assignedDoctorId: filter.assignedDoctorId });
    if (filter.agencyId) conditions.push({ agencyId: filter.agencyId });
    if (filter.procedure) {
      conditions.push({
        surgeries: {
          some: { procedureName: { contains: filter.procedure, mode: 'insensitive' } },
        },
      });
    }

    return { AND: conditions };
  }

  private cell(key: string, patient: PatientRow): unknown {
    switch (key) {
      case 'mrn':
        return patient.mrn;
      case 'firstName':
        return patient.firstName;
      case 'lastName':
        return patient.lastName;
      case 'birthDate':
        return day(patient.birthDate);
      case 'sex':
        return patient.sex;
      case 'country':
        return patient.country;
      case 'city':
        return patient.city;
      case 'nationality':
        return patient.nationality;
      case 'preferredLanguage':
        return patient.preferredLanguage;
      case 'status':
        return patient.status;
      case 'referralSource':
        return patient.referralSource;
      case 'assignedDoctor':
        return patient.assignedDoctor
          ? `${patient.assignedDoctor.firstName} ${patient.assignedDoctor.lastName}`.trim()
          : null;
      case 'agency':
        return patient.agency?.name ?? null;
      case 'createdAt':
        return day(patient.createdAt);

      case 'surgeryCount':
        return patient.surgeries?.length ?? 0;
      case 'lastProcedure':
        return patient.surgeries?.[0]?.procedureName ?? null;
      case 'lastProcedureAt':
        return patient.surgeries?.[0] ? day(patient.surgeries[0].performedAt) : null;

      case 'billedTotal':
        return this.money(patient, (record) => record.netAmount);
      case 'paidTotal':
        return this.money(patient, (record) => record.paidAmount);
      case 'balance':
        return this.money(patient, (record) => record.netAmount.minus(record.paidAmount));
      case 'currency':
        return this.currency(patient);
      case 'paymentStatus':
        return this.paymentStatus(patient);

      default:
        // Unreachable: the catalogue is closed and checked before we get here.
        return null;
    }
  }

  /**
   * A total across a patient's bills.
   *
   * Blank when the bills are in more than one currency, rather than a number
   * made by adding euros to lira. A cell in a spreadsheet has no room to
   * explain itself, and a wrong total in one is the kind that gets summed.
   */
  private money(patient: PatientRow, pick: (record: FinanceRow) => Prisma.Decimal): string | null {
    const records = patient.financeRecords ?? [];
    if (records.length === 0) return null;

    const currencies = new Set(records.map((record) => record.currency));
    if (currencies.size > 1) return null;

    return toAmountString(records.reduce((sum, record) => sum.plus(pick(record)), ZERO));
  }

  private currency(patient: PatientRow): string | null {
    const currencies = new Set((patient.financeRecords ?? []).map((record) => record.currency));

    // "KARIŞIK" rather than blank: a blank currency next to a blank total looks
    // like a patient with no bills, which is the opposite of the truth.
    if (currencies.size > 1) return 'KARIŞIK';

    return [...currencies][0] ?? null;
  }

  /** The worst outstanding state among a patient's bills. */
  private paymentStatus(patient: PatientRow): string | null {
    const records = patient.financeRecords ?? [];
    if (records.length === 0) return null;

    const order: PaymentStatus[] = [
      PaymentStatus.PENDING,
      PaymentStatus.PARTIAL,
      PaymentStatus.REFUNDED,
      PaymentStatus.CANCELLED,
      PaymentStatus.PAID,
    ];

    for (const status of order) {
      if (records.some((record) => record.paymentStatus === status)) return status;
    }

    return null;
  }
}

interface FinanceRow {
  currency: string;
  netAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  paymentStatus: PaymentStatus;
}

interface PatientRow {
  mrn: string;
  firstName: string;
  lastName: string;
  birthDate: Date;
  sex: string;
  country: string;
  city: string | null;
  nationality: string | null;
  preferredLanguage: string;
  status: string;
  referralSource: string | null;
  createdAt: Date;
  assignedDoctor: { firstName: string; lastName: string } | null;
  agency: { name: string } | null;
  surgeries?: { procedureName: string; performedAt: Date }[];
  financeRecords?: FinanceRow[];
}

/** Dates as `YYYY-MM-DD`: the form a spreadsheet sorts and a person reads. */
function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}
