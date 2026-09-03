import fontkit, { type Font } from 'fontkit';
import { MeasurementType, Sex } from '@prisma/client';
import { FontMissingError, TURKISH_ALPHABET, fonts, verify } from '../fonts';
import { assemble, type SummaryInput } from '../summary';
import { renderPatientSummary } from './render';

/**
 * Rendering the patient summary (spec M12, T6.5).
 *
 * The first test is the one that matters most and would be easiest to skip: the
 * PDF standard fonts are WinAnsi-encoded and have no ş, ğ, İ or ı. Rendering a
 * Turkish name in one of them does not fail — it silently produces something
 * the patient would not recognise as their own name.
 */
/** PDF strings are either PDFDoc-encoded or UTF-16BE; look for both. */
function occursIn(pdf: Buffer, text: string): boolean {
  const utf16be = Buffer.from(text, 'utf16le').swap16();

  return pdf.includes(Buffer.from(text, 'latin1')) || pdf.includes(utf16be);
}

describe('patient summary PDF', () => {
  const at = (day: number): Date => new Date(Date.UTC(2026, 2, day));

  const input = (overrides: Partial<SummaryInput> = {}): SummaryInput => ({
    patient: {
      mrn: 'MRN-1',
      firstName: 'Ayşe',
      lastName: 'Yıldırım-Çağlayan',
      birthDate: new Date('1981-04-02'),
      sex: Sex.FEMALE,
      country: 'DE',
      city: 'Berlin',
      preferredLanguage: 'tr',
    },
    surgeries: [],
    measurements: [],
    labs: [],
    medications: [],
    photos: [],
    aiReports: [],
    options: { includePhotos: false },
    generatedAt: at(10),
    generatedBy: 'Dr. Şeyma Öztürk',
    clinicName: 'Klinik Takip',
    ...overrides,
  });

  describe('the embedded font', () => {
    /** A TTC would have several faces; this file has one. */
    const open = (): Font => fontkit.openSync(fonts().regular) as Font;

    it('has a glyph for every letter Turkish uses', () => {
      const font = open();
      // Glyph 0 is .notdef — the empty box a reader sees instead of a letter.
      const missing = [...TURKISH_ALPHABET].filter((letter) =>
        font.layout(letter).glyphs.some((glyph) => glyph.id === 0),
      );

      expect(missing).toEqual([]);
    });

    it('refuses to draw anything when a font file is not there', () => {
      // pdfkit does not stop for a missing TTF, it falls back — and a clinical
      // summary rendered in empty boxes is worse than no summary, because
      // somebody will print it.
      expect(() => verify({ regular: '/nope/DejaVuSans.ttf', bold: '/nope/Bold.ttf' })).toThrow(
        FontMissingError,
      );

      // And says which one, so the fix is obvious.
      expect(() => verify({ ...fonts(), bold: '/nope/Bold.ttf' })).toThrow(/bold/);
    });

    it('has the dotted and dotless i, which is where Turkish usually breaks', () => {
      const font = open();

      for (const letter of ['İ', 'ı', 'ş', 'ğ']) {
        expect(font.layout(letter).glyphs[0]!.id).not.toBe(0);
      }
    });
  });

  it('produces a PDF', async () => {
    const pdf = await renderPatientSummary(assemble(input()));

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('keeps the patient name out of the document metadata', async () => {
    // A title travels further than a file's contents: it shows in a browser
    // tab, a download list and a printer queue. Content streams are compressed,
    // so anything findable as plain text in the file is metadata.
    const pdf = await renderPatientSummary(assemble(input()));

    // The file number identifies the record without naming the person.
    expect(occursIn(pdf, 'MRN-1')).toBe(true);
    expect(occursIn(pdf, 'Yıldırım')).toBe(false);
    expect(occursIn(pdf, 'Ayşe')).toBe(false);
  });

  it('renders a patient with nothing recorded at all', async () => {
    // A file opened this morning has no surgeries, no labs and no measurements,
    // and the summary still has to come out.
    const pdf = await renderPatientSummary(assemble(input()));

    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('renders a flat measurement series without dividing by its range', async () => {
    const summary = assemble(
      input({
        measurements: [1, 2, 3].map((day) => ({
          type: MeasurementType.WEIGHT,
          value: 80,
          secondaryValue: null,
          unit: 'kg',
          measuredAt: at(day),
        })),
      }),
    );

    const pdf = await renderPatientSummary(summary);
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('renders a single reading', async () => {
    const summary = assemble(
      input({
        measurements: [
          {
            type: MeasurementType.BLOOD_PRESSURE,
            value: 120,
            secondaryValue: 80,
            unit: 'mmHg',
            measuredAt: at(1),
          },
        ],
      }),
    );

    const pdf = await renderPatientSummary(summary);
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('survives a photograph it cannot decode', async () => {
    // A corrupt image must not take the whole report down with it.
    const summary = assemble(input({ options: { includePhotos: true } }));

    const pdf = await renderPatientSummary(summary, {
      photos: [{ id: 'p1', data: Buffer.from('not an image'), caption: 'öncesi' }],
    });

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('runs to several pages when there is a lot to say', async () => {
    const summary = assemble(
      input({
        labs: Array.from({ length: 40 }, (_, index) => ({
          analyteName: `Analit ${index}`,
          value: index,
          unit: 'mg/dL',
          refLow: 1,
          refHigh: 10,
          flag: null,
          measuredAt: at(1 + (index % 28)),
          verifiedAt: at(2),
        })),
        medications: Array.from({ length: 20 }, (_, index) => ({
          drugName: `İlaç ${index}`,
          dose: '500 mg',
          schedule: 'günde 2',
          startDate: at(1),
          stoppedAt: null,
          adherencePercent: index % 2 === 0 ? 80 : null,
        })),
      }),
    );

    const pdf = await renderPatientSummary(summary);

    // More than one page object in the file.
    expect(pdf.toString('latin1').split('/Type /Page\n').length).toBeGreaterThan(1);
    expect(pdf.length).toBeGreaterThan(5000);
  });
});
