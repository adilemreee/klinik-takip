import { BOM, escapeField, neutralise, provenance, toRow } from './csv';

/**
 * CSV writing (spec M12, T6.6).
 *
 * The first group of tests is a security property, not a formatting one: a
 * patient types their own name at registration, and a spreadsheet executes a
 * cell that begins with an equals sign.
 */
describe('csv', () => {
  describe('formula injection', () => {
    it.each([
      ['=1+1', "'=1+1"],
      ['=HYPERLINK("http://evil.invalid","Click")', '\'=HYPERLINK("http://evil.invalid","Click")'],
      ['+44 20 7946', "'+44 20 7946"],
      ['-1', "'-1"],
      ['@SUM(A1)', "'@SUM(A1)"],
      ['\tcmd', "'\tcmd"],
    ])('neutralises %p', (input, expected) => {
      expect(neutralise(input)).toBe(expected);
    });

    it('leaves an ordinary value exactly as it was recorded', () => {
      // The apostrophe is an escape, not a rewrite: a value that was never
      // dangerous must come out of the export identical to what is in the file.
      expect(neutralise('Ayşe Yılmaz')).toBe('Ayşe Yılmaz');
      expect(neutralise('0532 123 45 67')).toBe('0532 123 45 67');
      expect(neutralise('')).toBe('');
    });

    it('escapes inside a quoted field too', () => {
      // Quoting does not protect a cell: the spreadsheet strips the quotes and
      // then reads what is inside as a formula.
      expect(escapeField('=1+1,2')).toBe('"\'=1+1,2"');
    });
  });

  describe('quoting', () => {
    it('quotes a value containing the delimiter', () => {
      expect(escapeField('Berlin, DE')).toBe('"Berlin, DE"');
    });

    it('doubles an embedded quote', () => {
      expect(escapeField('the "big" one')).toBe('"the ""big"" one"');
    });

    it('quotes a value with a newline in it', () => {
      // A note field with a line break would otherwise become two rows, and
      // every column after it would be one out for the rest of the file.
      expect(escapeField('line one\nline two')).toBe('"line one\nline two"');
    });

    it('leaves an ordinary value unquoted', () => {
      expect(escapeField('Ayşe')).toBe('Ayşe');
    });

    it('writes nothing for a missing value rather than the word null', () => {
      expect(escapeField(null)).toBe('');
      expect(escapeField(undefined)).toBe('');
    });

    it('writes a date in a form that sorts', () => {
      expect(escapeField(new Date('2026-03-02T09:00:00.000Z'))).toBe(
        '2026-03-02T09:00:00.000Z',
      );
    });

    it('respects a different delimiter', () => {
      // Turkish Excel defaults to semicolons.
      expect(escapeField('a,b', ';')).toBe('a,b');
      expect(escapeField('a;b', ';')).toBe('"a;b"');
    });
  });

  describe('rows', () => {
    it('ends a row the way every spreadsheet reads it', () => {
      expect(toRow(['a', 'b'])).toBe('a,b\r\n');
    });

    it('keeps empty cells in place', () => {
      // Dropping them would shift every column after the gap.
      expect(toRow(['a', null, 'c'])).toBe('a,,c\r\n');
    });
  });

  describe('the byte-order mark', () => {
    it('is the three bytes Excel needs to read Turkish', () => {
      // Without it Excel reads the file as the local codepage and "Ayşe"
      // arrives as "AyÅŸe". No amount of correct UTF-8 fixes that.
      expect(Buffer.from(BOM, 'utf8')).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    });
  });

  describe('provenance', () => {
    it('puts the filter above the data, with a blank line after it', () => {
      // A spreadsheet in a shared folder with no provenance gets read as "all
      // our patients" whatever it actually contains.
      const block = provenance([
        ['Dışa aktaran', 'Dr. Test'],
        ['Filtre', 'ülke=DE'],
        ['Satır sayısı', '12'],
      ]);

      expect(block).toContain('Dr. Test');
      expect(block).toContain('ülke=DE');
      expect(block.endsWith('\r\n\r\n')).toBe(true);
    });

    it('neutralises a filter value too', () => {
      // The filter is user input like any other.
      expect(provenance([['Filtre', '=1+1']])).toContain("'=1+1");
    });
  });
});
