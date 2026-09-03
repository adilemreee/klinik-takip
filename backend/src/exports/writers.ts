import { PassThrough, Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import type { ColumnDefinition } from './columns';
import { BOM, neutralise, provenance, toRow } from './csv';

/**
 * Turning rows into a file (spec M12, T6.6).
 *
 * Both writers consume the same async row source and stream their output
 * straight at storage, so a clinic with forty thousand files never has to fit
 * in the worker's memory to get a spreadsheet of it.
 */

export type ExportFormat = 'CSV' | 'XLSX';

export interface WriteOptions {
  columns: ColumnDefinition[];
  rows: AsyncIterable<unknown[]>;
  /** Printed above the data: who, when, which filter, how many. */
  provenance: [string, string][];
}

export interface WrittenFile {
  stream: Readable;
  mime: string;
  extension: string;
}

export const FORMAT_TYPES: Record<ExportFormat, { mime: string; extension: string }> = {
  CSV: { mime: 'text/csv; charset=utf-8', extension: 'csv' },
  XLSX: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  },
};

export function write(format: ExportFormat, options: WriteOptions): WrittenFile {
  return {
    stream: format === 'CSV' ? csvStream(options) : xlsxStream(options),
    ...FORMAT_TYPES[format],
  };
}

function csvStream(options: WriteOptions): Readable {
  return Readable.from(csvChunks(options));
}

async function* csvChunks(options: WriteOptions): AsyncGenerator<string> {
  // The byte-order mark first, or Excel reads the whole file as the local
  // codepage and every Turkish name in it comes out wrong.
  yield BOM;
  yield provenance(options.provenance);
  yield toRow(options.columns.map((column) => column.header));

  for await (const row of options.rows) {
    yield toRow(row);
  }
}

/**
 * XLSX through ExcelJS's streaming writer.
 *
 * Values are neutralised the same way as in CSV. A spreadsheet cell whose
 * string begins with `=` is a formula in an xlsx too — the file format is
 * different, the behaviour on opening is not.
 */
function xlsxStream(options: WriteOptions): Readable {
  const output = new PassThrough();

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useStyles: true,
  });

  void (async () => {
    try {
      const notes = workbook.addWorksheet('Bilgi');
      for (const [label, value] of options.provenance) {
        notes.addRow([label, neutralise(String(value))]).commit();
      }
      notes.commit();

      const sheet = workbook.addWorksheet('Veri');
      sheet.columns = options.columns.map((column) => ({
        header: column.header,
        key: column.key,
        width: Math.max(12, Math.min(column.header.length + 6, 40)),
      }));
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).commit();

      for await (const row of options.rows) {
        sheet.addRow(row.map(cell)).commit();
      }

      sheet.commit();
      await workbook.commit();
    } catch (error) {
      output.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return output;
}

/**
 * One cell.
 *
 * Numbers and dates keep their types so the spreadsheet can sort and sum them;
 * strings are neutralised so it cannot execute them.
 */
function cell(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  // Anything else is already a string by the time it gets here — the row
  // builder produces primitives — but say so rather than stringifying an
  // object into "[object Object]" and putting that in somebody's spreadsheet.
  return neutralise(typeof value === 'string' ? value : JSON.stringify(value));
}
