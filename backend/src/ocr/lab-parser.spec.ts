import type { OcrLine } from './ocr-engine';
import { parseLabLines, parseReference, toNumber } from './lab-parser';

const line = (text: string, confidence = 0.95): OcrLine => ({
  text,
  confidence,
  words: [],
});

/**
 * The parser decides what number ends up in a clinical record.
 *
 * Two failure modes matter and they are not symmetrical. A result it fails to
 * read costs a doctor one keystroke. A result it reads wrongly is a wrong
 * number that looks exactly as trustworthy as a right one. Every ambiguous case
 * below is therefore expected to be refused, not guessed.
 */
describe('reading lab values off a report', () => {
  describe('a single result', () => {
    it('reads name, value, unit and range', () => {
      const [result] = parseLabLines([line('Hemoglobin 13.5 g/dL 12.0 - 16.0')]);

      expect(result).toMatchObject({
        rawName: 'Hemoglobin',
        value: 13.5,
        unit: 'g/dL',
        reference: { low: 12, high: 16 },
      });
    });

    /** Reports arrive from every country the clinic's patients come from. */
    it('reads a comma decimal', () => {
      const [result] = parseLabLines([line('Hemoglobin 13,5 g/dL 12,0 - 16,0')]);

      expect(result).toMatchObject({ value: 13.5, reference: { low: 12, high: 16 } });
    });

    it('reads a value with no reference range', () => {
      const [result] = parseLabLines([line('CRP 4.2 mg/L')]);

      expect(result).toMatchObject({ rawName: 'CRP', value: 4.2, unit: 'mg/L' });
      expect(result!.reference).toBeUndefined();
    });

    it('reads a percentage', () => {
      const [result] = parseLabLines([line('HbA1c 5.8 % 4.0 - 6.0')]);

      expect(result).toMatchObject({ value: 5.8, unit: '%' });
    });

    it('keeps the printed name for the reviewer', () => {
      const [result] = parseLabLines([line('Vitamin B12 210 pg/mL 197 - 771')]);

      expect(result!.rawName).toBe('Vitamin B12');
      expect(result!.sourceLine).toBe('Vitamin B12 210 pg/mL 197 - 771');
    });

    it('strips table furniture from the name', () => {
      const [result] = parseLabLines([line('3) | Kreatinin 0.9 mg/dL 0.6 - 1.2')]);

      expect(result!.rawName).toBe('Kreatinin');
    });

    it('normalises the several ways micro is printed', () => {
      const [result] = parseLabLines([line('Lökosit 7.4 10^3/uL 4.0 - 10.0')]);

      expect(result!.unit).toBe('10^3/µL');
    });
  });

  describe('reference ranges', () => {
    it('reads an upper bound only', () => {
      expect(parseReference('< 200')).toEqual({ high: 200 });
    });

    it('reads a lower bound only', () => {
      expect(parseReference('> 40')).toEqual({ low: 40 });
    });

    it.each(['12.0 - 16.0', '12.0-16.0', '12.0 – 16.0', '12.0 to 16.0', '12.0 ile 16.0'])(
      'reads %s',
      (text) => {
        expect(parseReference(text)).toEqual({ low: 12, high: 16 });
      },
    );

    /**
     * A range read backwards would flag every value inside it as abnormal —
     * turning a normal result into a red one on a doctor's screen.
     */
    it('refuses a range whose ends are reversed', () => {
      expect(parseReference('16.0 - 12.0')).toBeUndefined();
    });

    it('reports no range when the line has none', () => {
      expect(parseReference('final')).toBeUndefined();
    });
  });

  describe('what it refuses to read', () => {
    it('skips a line with no recognised unit', () => {
      expect(parseLabLines([line('Rapor tarihi 12.03.2026')])).toEqual([]);
    });

    it('skips a heading with no value', () => {
      expect(parseLabLines([line('BİYOKİMYA')])).toEqual([]);
    });

    it('skips a row number that carries no analyte name', () => {
      expect(parseLabLines([line('1. 2.5 mg/dL')])).toEqual([]);
    });

    /**
     * "1,234" is a thousand in one country and 1.234 in another, and a lab
     * report gives no way to tell. Refusing costs a doctor one keystroke;
     * picking wrong puts a value off by a factor of a thousand into a record.
     */
    it('refuses a lone comma with three digits after it', () => {
      expect(toNumber('1,234')).toBeNull();
      expect(parseLabLines([line('Trombosit 1,234 10^3/µL')])).toEqual([]);
    });

    it('reads a grouped number when the decimal separator is unambiguous', () => {
      expect(toNumber('1.234,5')).toBe(1234.5);
      expect(toNumber('1,234.5')).toBe(1234.5);
    });

    it('skips an empty line', () => {
      expect(parseLabLines([line('   ')])).toEqual([]);
    });
  });

  describe('confidence', () => {
    /**
     * The engine's doubt travels with the value so the review screen can mark
     * it. OCR output is never clinical until a human confirms it (spec M16),
     * and the fields worth looking at first are the doubtful ones.
     */
    it('carries the line confidence onto the result', () => {
      const [result] = parseLabLines([line('Hemoglobin 13.5 g/dL', 0.42)]);

      expect(result!.confidence).toBeCloseTo(0.42);
    });
  });

  describe('a whole report', () => {
    it('reads the results and ignores everything else', () => {
      const report = [
        'ACME LABORATUVARLARI',
        'Hasta: A. Y.   Tarih: 12.03.2026',
        '',
        'HEMOGRAM',
        'Hemoglobin 13.5 g/dL 12.0 - 16.0',
        'Hematokrit 41.2 % 36.0 - 46.0',
        'Lökosit 7.4 10^3/µL 4.0 - 10.0',
        '',
        'BİYOKİMYA',
        'Glukoz 92 mg/dL 70 - 100',
        'Kreatinin 0,9 mg/dL 0,6 - 1,2',
        'CRP 4.2 mg/L < 5',
        '',
        'Onaylayan: Dr. M. K.',
      ].map((text) => line(text));

      const results = parseLabLines(report);

      expect(results.map((result) => result.rawName)).toEqual([
        'Hemoglobin',
        'Hematokrit',
        'Lökosit',
        'Glukoz',
        'Kreatinin',
        'CRP',
      ]);
      expect(results.map((result) => result.value)).toEqual([13.5, 41.2, 7.4, 92, 0.9, 4.2]);
      expect(results[5]!.reference).toEqual({ high: 5 });
    });
  });
});

/**
 * Read off the actual output of the actual engine.
 *
 * These are not hypothetical confusions: each one came from running Tesseract
 * over a printed lab report. A parser tuned only to clean text is a parser that
 * works on everything except its input.
 */
describe('confusions real OCR actually produces', () => {
  it('reads a caret misread as an asterisk', () => {
    const [result] = parseLabLines([line('Lokosit 7.4 10*3/uL 4.0 - 10.0')]);

    expect(result).toMatchObject({ value: 7.4, unit: '10^3/µL' });
  });

  /** Stored under one spelling, or a trend chart splits into two series. */
  it('stores both spellings of the same unit identically', () => {
    const [asterisk] = parseLabLines([line('Lokosit 7.4 10*3/uL')]);
    const [caret] = parseLabLines([line('Lokosit 7.4 10^3/µL')]);

    expect(asterisk!.unit).toBe(caret!.unit);
  });

  it('reads a range printed without a space after the bound', () => {
    const [result] = parseLabLines([line('CRP 4.2 mg/L <5')]);

    expect(result!.reference).toEqual({ high: 5 });
  });
});
