import { LabFlag, RiskLevel } from '@prisma/client';
import {
  MAX_RESULTS,
  disclaimerFor,
  mayAutoRelease,
  parseInterpretation,
  renderPanel,
  selectResults,
  type PanelResult,
} from './lab-report';
import { RED_LINES, SYSTEM_PROMPT, buildUserPrompt } from './lab-report.prompt';
import { findLeaks } from '../ai/pseudonymise';

const result = (
  analyteName: string,
  value: number,
  flag: LabFlag | null,
  overrides: Partial<PanelResult> = {},
): PanelResult => ({
  analyteName,
  value,
  unit: 'g/dL',
  refLow: 12,
  refHigh: 16,
  flag,
  measuredAt: new Date('2026-03-01T08:00:00.000Z'),
  ...overrides,
});

/**
 * Turning a panel into a prompt, and reading the answer back.
 *
 * The whole of what leaves the building is in here, which is why it is a pure
 * function with tests rather than string-building inside a method that also
 * talks to four other things.
 */
describe('choosing what to interpret', () => {
  it('puts the abnormal values first', () => {
    const chosen = selectResults([
      result('Sodyum', 140, LabFlag.NORMAL),
      result('Hemoglobin', 6, LabFlag.CRITICAL),
      result('Lökosit', 12, LabFlag.HIGH),
    ]);

    expect(chosen.map((r) => r.analyteName)).toEqual(['Hemoglobin', 'Lökosit', 'Sodyum']);
  });

  /**
   * If anything is dropped it has to be the normal values. A truncation that
   * took the critical ones would produce a reassuring summary of an alarming
   * panel.
   */
  it('drops the normal values rather than the critical ones', () => {
    const many = [
      ...Array.from({ length: 60 }, (_, index) => result(`Analit${index}`, 1, LabFlag.NORMAL)),
      result('Hemoglobin', 6, LabFlag.CRITICAL),
    ];

    const chosen = selectResults(many);

    expect(chosen).toHaveLength(MAX_RESULTS);
    expect(chosen[0]!.analyteName).toBe('Hemoglobin');
  });

  it('treats a missing flag as normal rather than dropping the row', () => {
    const chosen = selectResults([result('Üre', 30, null)]);

    expect(chosen).toHaveLength(1);
  });
});

describe('rendering the panel', () => {
  it('writes one result per line with its range and flag', () => {
    const rendered = renderPanel([result('Hemoglobin', 10.2, LabFlag.LOW)]);

    expect(rendered.split('\n')[1]).toBe('Hemoglobin | 10.2 | g/dL | 12-16 | LOW');
  });

  it('says so when there is no reference range', () => {
    const rendered = renderPanel([
      result('Serbest T4', 1.1, null, { refLow: null, refHigh: null, unit: 'ng/dL' }),
    ]);

    expect(rendered).toContain('referans yok');
  });

  it('handles a one-sided range', () => {
    expect(renderPanel([result('D vitamini', 18, LabFlag.LOW, { refHigh: null })])).toContain('>12');
    expect(renderPanel([result('CRP', 8, LabFlag.HIGH, { refLow: null })])).toContain('<16');
  });

  /**
   * The column separator is a pipe rather than a space or a dash, because those
   * are what the identifier scan reads as part of a run of digits — a panel
   * written with them can splice two innocent values into something that looks
   * like a phone number and get the whole report refused.
   */
  it('does not produce a panel the identifier scan reads as a phone number', () => {
    const panel = renderPanel([
      result('Trombosit', 431112, LabFlag.HIGH, { unit: '10^3/uL', refLow: 150, refHigh: 400 }),
      result('Lökosit', 233450, LabFlag.HIGH, { unit: '10^3/uL', refLow: 4, refHigh: 11 }),
    ]);

    expect(findLeaks(panel, { phone: '+90 532 111 22 33' })).toEqual([]);
  });
});

describe('reading the interpretation', () => {
  const good = JSON.stringify({
    riskLevel: 'HIGH',
    doctorMd: '## Bulgular\nHemoglobin düşük.',
    patientMd: 'Kan değerlerinizden biri beklenenin altında.',
  });

  it('reads a well-formed answer', () => {
    const parsed = parseInterpretation(good);

    expect(parsed?.riskLevel).toBe(RiskLevel.HIGH);
    expect(parsed?.doctorMd).toContain('Hemoglobin');
    expect(parsed?.patientMd).toContain('beklenenin altında');
  });

  it('digs the object out of a code fence', () => {
    expect(parseInterpretation('```json\n' + good + '\n```')?.riskLevel).toBe(RiskLevel.HIGH);
  });

  /**
   * Both renderings or neither. Only the clinical half would be released to a
   * patient as an empty page; only the plain half leaves the doctor reading the
   * patient's version as if it were a clinical summary.
   */
  it('refuses an answer with only one of the two renderings', () => {
    expect(
      parseInterpretation('{"riskLevel":"LOW","doctorMd":"var","patientMd":""}'),
    ).toBeNull();
    expect(
      parseInterpretation('{"riskLevel":"LOW","doctorMd":"","patientMd":"var"}'),
    ).toBeNull();
  });

  it('refuses a risk level the model invented', () => {
    expect(parseInterpretation('{"riskLevel":"SEVERE","doctorMd":"a","patientMd":"b"}')).toBeNull();
  });

  /** A parser with a default risk has become the thing that decides how alarming a result is. */
  it('has no default to fall back to', () => {
    for (const raw of ['', 'Bilmiyorum', '{}', '{"doctorMd":"a","patientMd":"b"}']) {
      expect(parseInterpretation(raw)).toBeNull();
    }
  });

  it('accepts a lowercase risk level, because models do that', () => {
    expect(
      parseInterpretation('{"riskLevel":"critical","doctorMd":"a","patientMd":"b"}')?.riskLevel,
    ).toBe(RiskLevel.CRITICAL);
  });
});

/**
 * The rule from M5, made into a function so it can be argued with in one place.
 */
describe('what may reach the patient unread', () => {
  it('releases nothing by default', () => {
    for (const risk of Object.values(RiskLevel)) {
      expect(mayAutoRelease(risk, false)).toBe(false);
    }
  });

  it('releases only the calm ones when a clinic switches it on', () => {
    expect(mayAutoRelease(RiskLevel.LOW, true)).toBe(true);
    expect(mayAutoRelease(RiskLevel.MEDIUM, true)).toBe(true);
  });

  /**
   * There is deliberately no setting for this. An AI telling a post-operative
   * patient abroad that something is seriously wrong, before anyone at the
   * clinic has seen it, is the one outcome the rest of this system would not
   * forgive.
   */
  it('never releases an alarming one, whatever the setting says', () => {
    expect(mayAutoRelease(RiskLevel.HIGH, true)).toBe(false);
    expect(mayAutoRelease(RiskLevel.CRITICAL, true)).toBe(false);
  });
});

describe('the disclaimer', () => {
  it('is written in the patient\'s language', () => {
    expect(disclaimerFor('tr')).toContain('yapay zeka');
    expect(disclaimerFor('en')).toContain('AI');
  });

  it('falls back to Turkish and is never empty', () => {
    for (const language of [null, undefined, '', 'ru', 'de']) {
      expect(disclaimerFor(language)).toContain('yapay zeka');
    }
  });

  it('says it is not a diagnosis, which is the whole point of it', () => {
    expect(disclaimerFor('tr')).toContain('tanı yerine geçmez');
    expect(disclaimerFor('en')).toContain('not a medical diagnosis');
  });
});

describe('the fixed rules in the system prompt', () => {
  it.each(RED_LINES)('states: %s', (line) => {
    expect(SYSTEM_PROMPT).toContain(line);
  });

  it('tells the model the patient text is informative and not a diagnosis', () => {
    expect(SYSTEM_PROMPT).toContain('Bilgilendiricidir, tanı değildir');
  });

  it('forbids calling a value abnormal with no range to judge it against', () => {
    expect(SYSTEM_PROMPT).toContain('Referans aralığı verilmemiş');
  });

  it('asks for both renderings and a risk level', () => {
    expect(SYSTEM_PROMPT).toContain('doctorMd');
    expect(SYSTEM_PROMPT).toContain('patientMd');
    expect(SYSTEM_PROMPT).toContain('riskLevel');
  });
});

describe('the user prompt', () => {
  it('carries the panel and the little context that changes how it reads', () => {
    const prompt = buildUserPrompt(renderPanel([result('Hemoglobin', 10.2, LabFlag.LOW)]), {
      age: 45,
      sex: 'FEMALE',
      daysSinceSurgery: 9,
      procedureName: 'Sleeve gastrektomi',
    });

    expect(prompt).toContain('Hemoglobin');
    expect(prompt).toContain('9 gün');
    expect(prompt).toContain('45');
  });

  it('carries nothing that could identify the patient', () => {
    const prompt = buildUserPrompt('Analit | Değer', {
      age: 45,
      sex: 'FEMALE',
      daysSinceSurgery: null,
      procedureName: null,
    });

    expect(prompt).not.toMatch(/mrn|dosya no|telefon|e-posta/i);
    expect(prompt).toContain('Ameliyat kaydı yok');
  });
});
