import { parseCostItems } from './cost-items';
import { toAmountString } from './money';

/**
 * The cost side of a bill (spec M11, T6.4).
 *
 * The property that matters: a line that cannot be read is **counted**, not
 * skipped. A margin computed from three of five cost lines, with nothing
 * saying two were dropped, is a number that looks right and is not.
 */
describe('cost items', () => {
  it('adds up the lines', () => {
    const parsed = parseCostItems([
      { label: 'İmplant', amount: '1200.00' },
      { label: 'Anestezi', amount: '300.50' },
    ]);

    expect(toAmountString(parsed.total)).toBe('1500.50');
    expect(parsed.items).toHaveLength(2);
    expect(parsed.unreadable).toBe(0);
  });

  it('counts what it cannot read instead of ignoring it', () => {
    const parsed = parseCostItems([
      { label: 'İmplant', amount: '1200.00' },
      { label: 'Bozuk', amount: 'çok' },
      { note: 'no label' },
      'a bare string',
      null,
    ]);

    expect(toAmountString(parsed.total)).toBe('1200.00');
    expect(parsed.unreadable).toBe(4);
  });

  it('refuses a negative cost, which would quietly raise the margin', () => {
    const parsed = parseCostItems([
      { label: 'İmplant', amount: '1200.00' },
      { label: 'Ters', amount: '-500.00' },
    ]);

    expect(toAmountString(parsed.total)).toBe('1200.00');
    expect(parsed.unreadable).toBe(1);
  });

  it('reads a number as well as a string, because older rows have both', () => {
    const parsed = parseCostItems([{ label: 'İmplant', amount: 1200 }]);

    expect(toAmountString(parsed.total)).toBe('1200.00');
  });

  it('treats a column that is not a list as one unreadable thing', () => {
    // The column was free-form once, so something else may be in there.
    const parsed = parseCostItems({ implant: 1200 });

    expect(toAmountString(parsed.total)).toBe('0.00');
    expect(parsed.unreadable).toBe(1);
  });

  it.each([null, undefined, []])('has nothing to say about %p', (value) => {
    const parsed = parseCostItems(value);

    expect(toAmountString(parsed.total)).toBe('0.00');
    expect(parsed.unreadable).toBe(0);
    expect(parsed.items).toEqual([]);
  });
});
