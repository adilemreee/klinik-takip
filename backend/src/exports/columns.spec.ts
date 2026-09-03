import {
  ColumnError,
  DEFAULT_PATIENT_COLUMNS,
  PATIENT_COLUMNS,
  groupsOf,
  resolveColumns,
} from './columns';

/**
 * Choosing the columns of a bulk export (spec M12, T6.6).
 *
 * A spreadsheet is the easiest place in the system to take out more than
 * somebody is entitled to, so the catalogue is closed and every column carries
 * the permission it needs.
 */
describe('export columns', () => {
  const all = new Set(PATIENT_COLUMNS.map((column) => column.permission));
  const clinicalOnly = new Set(['patients.read', 'medical.read']);

  it('gives a sensible default when nothing is asked for', () => {
    const columns = resolveColumns(undefined, all);

    expect(columns.map((column) => column.key)).toEqual(DEFAULT_PATIENT_COLUMNS);
  });

  it('treats an empty list as "no preference", not "no columns"', () => {
    // A client that sends `columns: []` — an unticked picker, a cleared filter
    // — would otherwise get a spreadsheet with a provenance block and nothing
    // under it, which looks like a clinic with no patients.
    const columns = resolveColumns([], all);

    expect(columns.map((column) => column.key)).toEqual(DEFAULT_PATIENT_COLUMNS);
  });

  it('keeps the order the caller asked for', () => {
    const columns = resolveColumns(['country', 'mrn'], all);

    expect(columns.map((column) => column.key)).toEqual(['country', 'mrn']);
  });

  describe('a column the caller may not have', () => {
    it('is refused, not quietly dropped', () => {
      // A spreadsheet arriving with three of the five columns somebody asked
      // for looks like a complete spreadsheet: the missing column is not a
      // blank space, it is simply not there.
      expect(() => resolveColumns(['mrn', 'balance'], clinicalOnly)).toThrow(ColumnError);
    });

    it('says which ones, so the person can fix the request', () => {
      try {
        resolveColumns(['mrn', 'balance', 'paidTotal'], clinicalOnly);
        throw new Error('should have refused');
      } catch (error) {
        expect(error).toBeInstanceOf(ColumnError);
        expect((error as ColumnError).columns).toEqual(['balance', 'paidTotal']);
      }
    });

    it('lets the same caller have the columns they do hold', () => {
      const columns = resolveColumns(['mrn', 'lastProcedure'], clinicalOnly);

      expect(columns.map((column) => column.key)).toEqual(['mrn', 'lastProcedure']);
    });
  });

  describe('a column that does not exist', () => {
    it('is refused rather than silently ignored', () => {
      // A typo that produced a file with a missing column would be found weeks
      // later, by somebody reading a total that was never right.
      expect(() => resolveColumns(['mrn', 'passwordHash'], all)).toThrow(/Unknown column/);
    });
  });

  it('treats a column asked for twice as a typo', () => {
    const columns = resolveColumns(['mrn', 'mrn', 'country'], all);

    expect(columns.map((column) => column.key)).toEqual(['mrn', 'country']);
  });

  describe('the catalogue itself', () => {
    it('has no duplicate keys', () => {
      const keys = PATIENT_COLUMNS.map((column) => column.key);

      expect(new Set(keys).size).toBe(keys.length);
    });

    it('gives every column a permission and a heading', () => {
      for (const column of PATIENT_COLUMNS) {
        expect(column.permission).not.toBe('');
        expect(column.header).not.toBe('');
      }
    });

    it('keeps money behind the finance permission and nothing else', () => {
      // The same wall as everywhere else: spec section 2.
      const finance = PATIENT_COLUMNS.filter((column) => column.group === 'finance');

      expect(finance.length).toBeGreaterThan(0);
      expect(finance.every((column) => column.permission === 'finance.report')).toBe(true);
    });

    it('has a default that needs only the most ordinary permission', () => {
      const defaults = resolveColumns(undefined, new Set(['patients.read']));

      expect(defaults).toHaveLength(DEFAULT_PATIENT_COLUMNS.length);
    });
  });

  it('reports the groups a selection touches, for the manifest', () => {
    expect(groupsOf(resolveColumns(['mrn', 'balance', 'lastProcedure'], all))).toEqual([
      'clinical',
      'finance',
      'identity',
    ]);
  });
});
