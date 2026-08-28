import { generateMrn, isValidMrn } from './mrn';

describe('file numbers', () => {
  /**
   * A sequential file number tells anyone holding one roughly how many patients
   * the clinic has, and lets them walk the range.
   */
  it('is not sequential', () => {
    const suffixes = Array.from({ length: 50 }, () => generateMrn().split('-')[1]!);
    const sorted = [...suffixes].sort();

    expect(suffixes).not.toEqual(sorted);
  });

  it('is unique across many allocations', () => {
    const generated = new Set(Array.from({ length: 5000 }, () => generateMrn()));

    expect(generated.size).toBe(5000);
  });

  it('carries the year so staff can place it at a glance', () => {
    expect(generateMrn(new Date('2027-06-15T00:00:00Z'))).toMatch(/^2027-/);
  });

  /**
   * Patients and staff read this number aloud, often across a language barrier,
   * so characters that sound or look alike are excluded.
   */
  it.each(['O', '0', 'I', '1', 'L', 'U'])('never contains the ambiguous character %s', (character) => {
    const sample = Array.from({ length: 500 }, () => generateMrn().split('-')[1]!).join('');

    expect(sample).not.toContain(character);
  });

  it('accepts what it generates', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(isValidMrn(generateMrn())).toBe(true);
    }
  });

  it.each(['2026-ABC', 'ABCDEF', '26-ABCDEF', '2026-abcdef', '2026-ABC0EF', '2026-ABCLEF', ''])(
    'rejects the malformed value %s',
    (value) => {
      expect(isValidMrn(value)).toBe(false);
    },
  );
});
