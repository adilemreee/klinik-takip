import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { OcrEngine, OcrPage, OcrWord, groupIntoLines } from './ocr-engine';

const run = promisify(execFile);

/** Tesseract's TSV columns, in the order it emits them. */
const COLUMN = {
  level: 0,
  blockNum: 2,
  parNum: 3,
  lineNum: 4,
  conf: 10,
  text: 11,
} as const;

/**
 * Server-side OCR (spec section 3.2: on-device first, Tesseract on the server).
 *
 * TSV output rather than plain text, because plain text throws away the one
 * thing that decides whether a human has to look at a field: how sure the
 * engine was. A lab value read at 40% confidence and a lab value read at 99%
 * must not arrive looking the same.
 */
@Injectable()
export class TesseractEngine implements OcrEngine {
  private readonly logger = new Logger(TesseractEngine.name);

  async recognise(imagePath: string, languages = ['eng', 'tur']): Promise<OcrPage> {
    const { stdout } = await run(
      'tesseract',
      [imagePath, 'stdout', '-l', languages.join('+'), '--psm', '6', 'tsv'],
      { maxBuffer: 32 * 1024 * 1024 },
    );

    return { lines: groupIntoLines(parseTsv(stdout)) };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await run('tesseract', ['--version']);
      return true;
    } catch (error) {
      this.logger.error(`Tesseract is not available: ${String(error)}`);
      return false;
    }
  }
}

/**
 * Parses Tesseract's TSV.
 *
 * Exported and pure so the mapping from engine output to words is tested
 * against recorded output rather than against whatever version of the binary
 * happens to be installed.
 */
export function parseTsv(tsv: string): OcrWord[] {
  const words: OcrWord[] = [];

  for (const row of tsv.split('\n').slice(1)) {
    const cells = row.split('\t');
    // Level 5 is a word; the lower levels describe pages, blocks and lines.
    if (cells.length <= COLUMN.text || cells[COLUMN.level] !== '5') continue;

    const text = cells[COLUMN.text] ?? '';
    if (text.trim() === '') continue;

    const confidence = Number(cells[COLUMN.conf]);

    words.push({
      text,
      // Tesseract reports -1 for words it could not score. Treating that as
      // zero sends the field to a human, which is the safe direction.
      confidence: Number.isFinite(confidence) && confidence >= 0 ? confidence / 100 : 0,
      // Block and paragraph are part of the identity of a line: two blocks
      // both have a line 1, and merging them would splice unrelated text.
      line:
        Number(cells[COLUMN.blockNum]) * 1_000_000 +
        Number(cells[COLUMN.parNum]) * 1_000 +
        Number(cells[COLUMN.lineNum]),
    });
  }

  return words;
}
