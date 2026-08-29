import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Pages of a PDF as images, because OCR reads pixels.
 *
 * Capped because a scanner set to "every page" turns one upload into a job that
 * occupies a worker for minutes; a lab report that runs past this is one a
 * human should be opening anyway.
 */
export const MAX_PAGES = 20;

export async function rasterisePdf(
  pdfPath: string,
  outputDir: string,
  maxPages = MAX_PAGES,
): Promise<string[]> {
  await run('pdftoppm', [
    '-png',
    // 300 dpi: below this, OCR starts reading 8 as 3 on printed lab tables.
    '-r',
    '300',
    '-f',
    '1',
    '-l',
    String(maxPages),
    pdfPath,
    join(outputDir, 'page'),
  ]);

  const files = await readdir(outputDir);

  return files
    .filter((name) => name.startsWith('page') && name.endsWith('.png'))
    .sort()
    .map((name) => join(outputDir, name));
}
