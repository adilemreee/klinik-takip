import { Prisma } from '@prisma/client';
import { ZERO, money, round, type Money } from './money';

/**
 * The cost side of a bill (spec M11: gelir–gider).
 *
 * Costs were a free-form JSON column, which is fine for a note and useless for
 * a total: "gelir–gider" needs something summable. So the shape is fixed —
 * a list of `{ label, amount }` in the record's own currency — and validated on
 * the way in.
 *
 * Anything already stored that does not fit is **counted, not skipped**. A
 * margin computed from three of five cost lines, with no sign that two were
 * dropped, is a number that looks right and is not.
 */

export interface CostItem {
  label: string;
  amount: Money;
}

export interface ParsedCosts {
  items: CostItem[];
  total: Money;
  /** Entries that could not be read as a cost. Never silently ignored. */
  unreadable: number;
}

const EMPTY: ParsedCosts = { items: [], total: ZERO, unreadable: 0 };

export function parseCostItems(value: Prisma.JsonValue | null | undefined): ParsedCosts {
  if (value === null || value === undefined) return EMPTY;
  if (!Array.isArray(value)) return { items: [], total: ZERO, unreadable: 1 };

  const items: CostItem[] = [];
  let unreadable = 0;

  for (const entry of value) {
    const parsed = readOne(entry);

    if (parsed === null) unreadable += 1;
    else items.push(parsed);
  }

  return {
    items,
    total: round(items.reduce((sum, item) => sum.plus(item.amount), ZERO)),
    unreadable,
  };
}

function readOne(entry: Prisma.JsonValue): CostItem | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;

  const record = entry as Record<string, Prisma.JsonValue | undefined>;
  const label = record.label;
  const amount = record.amount;

  if (typeof label !== 'string') return null;
  if (typeof amount !== 'string' && typeof amount !== 'number') return null;

  try {
    const parsed = money(typeof amount === 'number' ? amount : amount);

    // A negative cost is a discount somebody put in the wrong column; it would
    // quietly raise the margin.
    if (parsed.isNegative()) return null;

    return { label, amount: parsed };
  } catch {
    return null;
  }
}
