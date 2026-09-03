/**
 * The columns a bulk export can contain, and who may have each one
 * (spec M12: seçilebilir kolonlar).
 *
 * A catalogue rather than a free-form field list, for two reasons. A caller
 * naming its own columns would be naming database fields, and a spreadsheet is
 * the easiest place in the system to take out more than somebody is entitled
 * to: a nurse who may not see money must not be able to ask for the balance
 * column and get it.
 */

export type ColumnGroup = 'identity' | 'clinical' | 'finance';

export interface ColumnDefinition {
  key: string;
  /** The heading printed in the file. */
  header: string;
  group: ColumnGroup;
  /** Held by the caller, or the column is refused. */
  permission: string;
}

/**
 * Patient list columns (spec M12: filtre bazlı toplu export).
 *
 * The groups are the same wall that runs through the rest of the system: a
 * clinician sees clinical columns, the finance desk sees money columns, and
 * neither gets the other's by asking nicely.
 */
export const PATIENT_COLUMNS: ColumnDefinition[] = [
  { key: 'mrn', header: 'Dosya no', group: 'identity', permission: 'patients.read' },
  { key: 'firstName', header: 'Ad', group: 'identity', permission: 'patients.read' },
  { key: 'lastName', header: 'Soyad', group: 'identity', permission: 'patients.read' },
  { key: 'birthDate', header: 'Doğum tarihi', group: 'identity', permission: 'patients.read' },
  { key: 'sex', header: 'Cinsiyet', group: 'identity', permission: 'patients.read' },
  { key: 'country', header: 'Ülke', group: 'identity', permission: 'patients.read' },
  { key: 'city', header: 'Şehir', group: 'identity', permission: 'patients.read' },
  { key: 'nationality', header: 'Uyruk', group: 'identity', permission: 'patients.read' },
  { key: 'preferredLanguage', header: 'Dil', group: 'identity', permission: 'patients.read' },
  { key: 'status', header: 'Durum', group: 'identity', permission: 'patients.read' },
  { key: 'referralSource', header: 'Kaynak', group: 'identity', permission: 'patients.read' },
  { key: 'assignedDoctor', header: 'Doktor', group: 'identity', permission: 'patients.read' },
  { key: 'agency', header: 'Aracı kurum', group: 'identity', permission: 'patients.read' },
  { key: 'createdAt', header: 'Kayıt tarihi', group: 'identity', permission: 'patients.read' },

  { key: 'surgeryCount', header: 'Ameliyat sayısı', group: 'clinical', permission: 'medical.read' },
  { key: 'lastProcedure', header: 'Son ameliyat', group: 'clinical', permission: 'medical.read' },
  { key: 'lastProcedureAt', header: 'Son ameliyat tarihi', group: 'clinical', permission: 'medical.read' },

  { key: 'billedTotal', header: 'Faturalanan', group: 'finance', permission: 'finance.report' },
  { key: 'paidTotal', header: 'Tahsil edilen', group: 'finance', permission: 'finance.report' },
  { key: 'balance', header: 'Kalan', group: 'finance', permission: 'finance.report' },
  { key: 'currency', header: 'Para birimi', group: 'finance', permission: 'finance.report' },
  { key: 'paymentStatus', header: 'Ödeme durumu', group: 'finance', permission: 'finance.report' },
];

/** What a caller gets when they ask for nothing in particular. */
export const DEFAULT_PATIENT_COLUMNS = [
  'mrn',
  'firstName',
  'lastName',
  'country',
  'status',
  'createdAt',
];

export class ColumnError extends Error {
  constructor(
    message: string,
    readonly columns: string[],
  ) {
    super(message);
  }
}

/**
 * The columns to write, or an error naming the ones that were refused.
 *
 * **Refused, not quietly dropped.** A spreadsheet that arrives with three of
 * the five columns somebody asked for looks like a complete spreadsheet — the
 * missing column is not a blank space, it is simply not there, and whoever
 * opens it later has no way to know it was ever meant to be. Refusing puts the
 * problem in front of the person who can fix it, at the moment they asked.
 */
export function resolveColumns(
  requested: string[] | undefined,
  held: Set<string>,
  catalogue: ColumnDefinition[] = PATIENT_COLUMNS,
): ColumnDefinition[] {
  const byKey = new Map(catalogue.map((column) => [column.key, column]));
  const keys = requested?.length ? requested : DEFAULT_PATIENT_COLUMNS;

  const unknown = keys.filter((key) => !byKey.has(key));
  if (unknown.length > 0) {
    throw new ColumnError(`Unknown column(s): ${unknown.join(', ')}`, unknown);
  }

  const chosen = keys.map((key) => byKey.get(key)!);
  const forbidden = chosen.filter((column) => !held.has(column.permission));

  if (forbidden.length > 0) {
    throw new ColumnError(
      `You may not export: ${forbidden.map((column) => column.key).join(', ')}`,
      forbidden.map((column) => column.key),
    );
  }

  // Deduplicated, keeping the caller's order: a column asked for twice is a
  // typo, not a request for two identical columns.
  const seen = new Set<string>();

  return chosen.filter((column) => {
    if (seen.has(column.key)) return false;
    seen.add(column.key);
    return true;
  });
}

/** Which groups a set of columns touches, for the export manifest. */
export function groupsOf(columns: ColumnDefinition[]): ColumnGroup[] {
  return [...new Set(columns.map((column) => column.group))].sort();
}
