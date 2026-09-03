import { MeasurementType, Sex } from '@prisma/client';
import {
  assemble,
  describeOmission,
  isOutOfRange,
  seriesOf,
  type SummaryInput,
  type SummaryLab,
  type SummaryPhoto,
} from './summary';

/**
 * What goes into a patient summary, and what is said about what does not
 * (spec M12, T6.5).
 *
 * Every test here is a version of the same rule: **nothing is omitted
 * silently.** A summary with no photo section reads as a patient with no
 * photographs, and a lab table missing the unverified results reads as a
 * complete set. Both are false, and a document that leaves the clinic carrying
 * a false impression is worse than one that carries less.
 */
describe('patient summary', () => {
  const at = (day: number): Date => new Date(Date.UTC(2026, 2, day));

  const lab = (overrides: Partial<SummaryLab> = {}): SummaryLab => ({
    analyteName: 'Hemoglobin',
    value: 13.2,
    unit: 'g/dL',
    refLow: 12,
    refHigh: 16,
    flag: null,
    measuredAt: at(2),
    verifiedAt: at(3),
    ...overrides,
  });

  const photo = (overrides: Partial<SummaryPhoto> = {}): SummaryPhoto => ({
    id: 'p1',
    fileKey: '2026/03/a.jpg',
    category: 'BEFORE',
    phaseLabel: 'pre-op',
    takenAt: at(1),
    hasLiveConsent: true,
    ...overrides,
  });

  const input = (overrides: Partial<SummaryInput> = {}): SummaryInput => ({
    patient: {
      mrn: 'MRN-1',
      firstName: 'Ayşe',
      lastName: 'Yılmaz',
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
    generatedBy: 'Dr. Test',
    clinicName: 'Klinik',
    ...overrides,
  });

  describe('laboratory results', () => {
    it('leaves out what no human has confirmed, and says how many', () => {
      // OCR output is not a result until somebody has checked it (spec M16).
      // Printing it in a document a doctor will read as fact is the failure.
      const summary = assemble(
        input({ labs: [lab(), lab({ verifiedAt: null }), lab({ verifiedAt: null })] }),
      );

      expect(summary.labs).toHaveLength(1);
      expect(summary.omissions).toContainEqual({
        section: 'labs',
        reason: 'lab-unverified',
        count: 2,
      });
    });

    it('says nothing when there is nothing to say', () => {
      // "0 results left out" on every report is noise, and noise is what stops
      // the real line being read.
      const summary = assemble(input({ labs: [lab()] }));

      expect(summary.omissions).toEqual([]);
    });

    it('puts the newest first', () => {
      const summary = assemble(
        input({ labs: [lab({ measuredAt: at(1) }), lab({ measuredAt: at(9) })] }),
      );

      expect(summary.labs[0]!.measuredAt).toEqual(at(9));
    });
  });

  describe('photographs', () => {
    it('are left out unless asked for, and counted', () => {
      // The most sensitive thing an export can carry, in a file that leaves the
      // clinic. Off unless somebody asks.
      const summary = assemble(input({ photos: [photo(), photo()] }));

      expect(summary.photos).toEqual([]);
      expect(summary.omissions).toContainEqual({
        section: 'photos',
        reason: 'photo-not-requested',
        count: 2,
      });
    });

    it('go in only with a live consent when they are asked for', () => {
      const summary = assemble(
        input({
          photos: [photo(), photo({ id: 'p2', hasLiveConsent: false })],
          options: { includePhotos: true },
        }),
      );

      expect(summary.photos.map((item) => item.id)).toEqual(['p1']);
      expect(summary.omissions).toContainEqual({
        section: 'photos',
        reason: 'photo-no-consent',
        count: 1,
      });
    });

    it('are ordered oldest first, because that is a before and after', () => {
      const summary = assemble(
        input({
          photos: [photo({ id: 'later', takenAt: at(9) }), photo({ id: 'earlier', takenAt: at(1) })],
          options: { includePhotos: true },
        }),
      );

      expect(summary.photos.map((item) => item.id)).toEqual(['earlier', 'later']);
    });
  });

  describe('AI text', () => {
    it('never enters the document unreviewed', () => {
      const summary = assemble(
        input({
          aiReports: [
            {
              source: 'lab',
              contentMd: 'onaylı',
              model: 'm',
              generatedAt: at(4),
              reviewedAt: at(5),
              reviewerName: 'Dr. Test',
            },
            {
              source: 'lab',
              contentMd: 'onaysız',
              model: 'm',
              generatedAt: at(6),
              reviewedAt: null,
              reviewerName: null,
            },
          ],
        }),
      );

      expect(summary.aiReports.map((report) => report.contentMd)).toEqual(['onaylı']);
      expect(summary.omissions).toContainEqual({
        section: 'ai',
        reason: 'ai-unreviewed',
        count: 1,
      });
    });
  });

  describe('measurements', () => {
    it('makes one series per type, oldest point first', () => {
      const series = seriesOf([
        { type: MeasurementType.WEIGHT, value: 82, secondaryValue: null, unit: 'kg', measuredAt: at(9) },
        { type: MeasurementType.WEIGHT, value: 80, secondaryValue: null, unit: 'kg', measuredAt: at(1) },
        { type: MeasurementType.TEMPERATURE, value: 36.6, secondaryValue: null, unit: '°C', measuredAt: at(2) },
      ]);

      const weight = series.find((item) => item.type === MeasurementType.WEIGHT);

      expect(series).toHaveLength(2);
      expect(weight!.points.map((point) => point.value)).toEqual([80, 82]);
      // The latest reading is the one printed beside the chart.
      expect(weight!.latest.value).toBe(82);
    });

    it('has no series at all when there are no measurements', () => {
      expect(seriesOf([])).toEqual([]);
    });
  });

  describe('reference ranges', () => {
    it('marks a value outside its own range', () => {
      expect(isOutOfRange(lab({ value: 10 }))).toBe(true);
      expect(isOutOfRange(lab({ value: 20 }))).toBe(true);
      expect(isOutOfRange(lab({ value: 13 }))).toBe(false);
    });

    it('does not invent a range that was not recorded', () => {
      expect(isOutOfRange(lab({ refLow: null, refHigh: null, value: 999 }))).toBe(false);
      // A one-sided range is still a range.
      expect(isOutOfRange(lab({ refLow: null, refHigh: 16, value: 20 }))).toBe(true);
    });
  });

  describe('the note printed for an omission', () => {
    it('gives the reason, not only the count', () => {
      // Otherwise the reader cannot tell whether the data is missing or does
      // not exist.
      const text = describeOmission({ section: 'labs', reason: 'lab-unverified', count: 2 });

      expect(text).toContain('2');
      expect(text).toContain('doğrulanmamış');
    });

    it('has wording for every reason', () => {
      for (const reason of [
        'lab-unverified',
        'photo-no-consent',
        'photo-not-requested',
        'ai-unreviewed',
      ] as const) {
        expect(describeOmission({ section: 's', reason, count: 1 })).not.toBe('');
      }
    });
  });
});
