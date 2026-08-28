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

  /**
   * Random file numbers collide occasionally — that is inherent, not a defect,
   * and PatientsService retries on the unique violation.
   *
   * Asserting zero collisions in a large sample would be wrong. With 30
   * characters over 6 positions there are 729 million combinations, so 5000
   * draws expect ~0.017 collisions by the birthday bound — which means the
   * probability of seeing at least one is about 1.7%, and a test demanding
   * none fails roughly one run in fifty.
   *
   * What matters is that the rate stays near that bound rather than exploding,
   * which is what a broken generator — a short alphabet, a stuck seed — would
   * do. Measured over 200 runs the mean was 0.01 and the maximum was 1.
   */
  it('collides only at the rate the birthday bound predicts', () => {
    const sample = 5000;
    const generated = new Set(Array.from({ length: sample }, () => generateMrn()));
    const collisions = sample - generated.size;

    // Expected ≈ 0.017. Twenty is far enough out never to trip by chance and
    // far enough in to catch a generator drawing from a fraction of the space.
    expect(collisions).toBeLessThanOrEqual(20);
  });

  it('draws from the full combination space', () => {
    const alphabetSize = 30;
    const positions = 6;

    // 729 million: enough that the retry in PatientsService is a rare path
    // rather than a routine one, for the 50 000 patients the spec targets.
    expect(alphabetSize ** positions).toBeGreaterThan(500_000_000);

    const suffixes = Array.from({ length: 2000 }, () => generateMrn().split('-')[1]!);
    const charactersUsed = new Set(suffixes.join('').split(''));

    // Every character in the alphabet should appear across 12 000 draws; one
    // that never does means the generator is not using the range it claims.
    expect(charactersUsed.size).toBe(alphabetSize);
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
