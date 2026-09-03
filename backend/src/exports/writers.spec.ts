import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { PATIENT_COLUMNS, resolveColumns } from './columns';
import { FORMAT_TYPES, write, type ExportFormat } from './writers';

/**
 * Writing a bulk export to a file (spec M12, T6.6).
 *
 * The property both formats share, and the reason this test file exists: a
 * cell beginning with `=` is a formula in a CSV *and* in an xlsx. The file
 * format differs; what a spreadsheet does when it opens one does not.
 */
describe('export writers', () => {
  const all = new Set(PATIENT_COLUMNS.map((column) => column.permission));
  const columns = resolveColumns(['mrn', 'firstName', 'country'], all);

  async function* rowsOf(rows: unknown[][]): AsyncGenerator<unknown[]> {
    for (const row of rows) {
      // A real row source waits on the database between pages.
      await Promise.resolve();
      yield row;
    }
  }

  const collect = async (stream: Readable): Promise<Buffer> => {
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
    }

    return Buffer.concat(chunks);
  };

  const provenance: [string, string][] = [
    ['Dışa aktaran', 'Dr. Şeyma'],
    ['Filtre', 'ülke=DE'],
    ['Satır sayısı', '2'],
  ];

  describe('CSV', () => {
    const build = (rows: unknown[][]): Readable =>
      write('CSV', { columns, rows: rowsOf(rows), provenance }).stream;

    it('starts with the mark Excel needs to read Turkish', async () => {
      const bytes = await collect(build([]));

      expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    });

    it('puts the provenance above the headings', async () => {
      const text = (await collect(build([]))).toString('utf8');
      const lines = text.split('\r\n');

      expect(lines[0]).toContain('Dr. Şeyma');
      expect(lines).toContain('Dosya no,Ad,Ülke');
      expect(text.indexOf('Filtre')).toBeLessThan(text.indexOf('Dosya no'));
    });

    it('writes a row per patient in the column order asked for', async () => {
      const text = (await collect(build([['MRN-1', 'Ayşe', 'DE']]))).toString('utf8');

      expect(text).toContain('MRN-1,Ayşe,DE');
    });

    it('neutralises a cell a spreadsheet would execute', async () => {
      // A patient types their own name at registration.
      const text = (
        await collect(build([['MRN-1', '=HYPERLINK("http://evil.invalid","x")', 'DE']]))
      ).toString('utf8');

      expect(text).toContain("'=HYPERLINK");
      expect(text).not.toMatch(/,=HYPERLINK/);
    });

    it('keeps an empty cell in its place', async () => {
      const text = (await collect(build([['MRN-1', null, 'DE']]))).toString('utf8');

      expect(text).toContain('MRN-1,,DE');
    });
  });

  describe('XLSX', () => {
    const build = (rows: unknown[][]): Readable =>
      write('XLSX', { columns, rows: rowsOf(rows), provenance }).stream;

    const open = async (stream: Readable): Promise<ExcelJS.Workbook> => {
      const workbook = new ExcelJS.Workbook();
      // ExcelJS types the argument as the DOM Buffer; the Node one is what
      // it actually reads.
      await workbook.xlsx.load((await collect(stream)) as unknown as ArrayBuffer);

      return workbook;
    };

    it('produces a workbook with the data and its provenance on separate sheets', async () => {
      const workbook = await open(build([['MRN-1', 'Ayşe', 'DE']]));

      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Bilgi', 'Veri']);

      const data = workbook.getWorksheet('Veri')!;
      expect(data.getRow(1).getCell(1).value).toBe('Dosya no');
      expect(data.getRow(2).getCell(2).value).toBe('Ayşe');
    });

    it('carries the filter on the information sheet', async () => {
      const workbook = await open(build([]));
      const notes = workbook.getWorksheet('Bilgi')!;

      expect(notes.getRow(2).getCell(2).value).toBe('ülke=DE');
    });

    it('neutralises a formula here too', async () => {
      // Different file format, same behaviour when a spreadsheet opens it.
      const workbook = await open(build([['MRN-1', '=1+1', 'DE']]));
      const data = workbook.getWorksheet('Veri')!;

      expect(data.getRow(2).getCell(2).value).toBe("'=1+1");
    });

    it('keeps a number a number, so the sheet can add it up', async () => {
      const numeric = resolveColumns(['mrn', 'surgeryCount'], all);
      const stream = write('XLSX', {
        columns: numeric,
        rows: rowsOf([['MRN-1', 3]]),
        provenance,
      }).stream;

      const workbook = await open(stream);
      expect(workbook.getWorksheet('Veri')!.getRow(2).getCell(2).value).toBe(3);
    });
  });

  it('reports the right type for each format', () => {
    for (const format of ['CSV', 'XLSX'] as ExportFormat[]) {
      const written = write(format, { columns, rows: rowsOf([]), provenance });

      expect(written.mime).toBe(FORMAT_TYPES[format].mime);
      expect(written.extension).toBe(FORMAT_TYPES[format].extension);
    }
  });
});
