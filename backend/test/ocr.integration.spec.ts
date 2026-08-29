import { join } from 'node:path';
import { parseLabLines } from '../src/ocr/lab-parser';
import { TesseractEngine } from '../src/ocr/tesseract.engine';

/**
 * The real engine, on a real image of a real-shaped lab report.
 *
 * The unit tests feed the parser clean text, which is exactly the input it will
 * never see. This is the one test that proves the two halves fit: that what
 * Tesseract emits is what the parser expects, down to the characters it gets
 * wrong.
 */
describe('OCR over a printed lab report', () => {
  const engine = new TesseractEngine();
  const fixture = join(__dirname, 'fixtures', 'lab-report.png');

  let available = false;

  beforeAll(async () => {
    available = await engine.isAvailable();
  });

  it('has tesseract on the path', () => {
    // Failing loudly rather than skipping: a silently skipped OCR test in CI is
    // a pipeline that stops checking the thing this module is for.
    expect(available).toBe(true);
  });

  it('reads every result off the page', async () => {
    const page = await engine.recognise(fixture, ['eng']);
    const results = parseLabLines(page.lines);

    expect(results.map((result) => result.rawName)).toEqual([
      'Hemoglobin',
      'Hematokrit',
      'Lokosit',
      'Glukoz',
      'Kreatinin',
      'CRP',
    ]);
    expect(results.map((result) => result.value)).toEqual([13.5, 41.2, 7.4, 92, 0.9, 4.2]);
  }, 60_000);

  it('reads the reference ranges', async () => {
    const page = await engine.recognise(fixture, ['eng']);
    const results = parseLabLines(page.lines);

    expect(results[0]!.reference).toEqual({ low: 12, high: 16 });
    expect(results.at(-1)!.reference).toEqual({ high: 5 });
  }, 60_000);

  it('ignores the letterhead, the headings and the signature', async () => {
    const page = await engine.recognise(fixture, ['eng']);
    const results = parseLabLines(page.lines);

    const names = results.map((result) => result.rawName.toLowerCase());

    expect(names.some((name) => name.includes('acme'))).toBe(false);
    expect(names.some((name) => name.includes('onaylayan'))).toBe(false);
    expect(names.some((name) => name.includes('hemogram'))).toBe(false);
  }, 60_000);

  /** The doubt has to survive to the review screen (spec M16). */
  it('carries a confidence for every result', async () => {
    const page = await engine.recognise(fixture, ['eng']);
    const results = parseLabLines(page.lines);

    for (const result of results) {
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  }, 60_000);

  /** Two blocks each have a line 1; merging them would splice unrelated text. */
  it('keeps lines from different blocks apart', async () => {
    const page = await engine.recognise(fixture, ['eng']);

    expect(page.lines.some((l) => l.text.includes('Hemoglobin') && l.text.includes('Glukoz'))).toBe(
      false,
    );
  }, 60_000);
});
