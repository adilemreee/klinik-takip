import { FINDINGS, flagFrom, isAssessable, parseAssessment } from './assessment';
import { SYSTEM_PROMPT, buildUserPrompt } from './assessment.prompt';
import { MAX_IMAGE_BYTES, textOf } from '../ai/ai-provider';

/**
 * The photo pre-assessment (spec M5).
 *
 * The specification is unusually precise here: redness, discharge or swelling
 * produce a **flag**, never a diagnosis. The precision is the design — the
 * model picks from a closed list and the flag is computed from the answer, so
 * the worst a jailbroken reply can do is name something that is not in the
 * vocabulary and be dropped.
 */
describe('reading an assessment', () => {
  it('reads the findings it recognises', () => {
    const parsed = parseAssessment('{"findings":["redness","discharge"]}');

    expect(parsed?.findings).toEqual(['redness', 'discharge']);
    expect(parsed?.reviewSuggested).toBe(true);
  });

  it('reads an empty finding list as nothing seen', () => {
    const parsed = parseAssessment('{"findings":[]}');

    expect(parsed?.findings).toEqual([]);
    expect(parsed?.reviewSuggested).toBe(false);
  });

  /**
   * This is where a diagnosis would have got in. "Selülit" is not in the
   * vocabulary and there is nowhere for it to go.
   */
  it('drops anything outside the vocabulary', () => {
    const parsed = parseAssessment(
      '{"findings":["redness","selülit şüphesi","enfeksiyon","abscess"]}',
    );

    expect(parsed?.findings).toEqual(['redness']);
  });

  it('drops a repeated finding', () => {
    expect(parseAssessment('{"findings":["redness","redness"]}')?.findings).toEqual(['redness']);
  });

  it('accepts the findings in any case, because models do that', () => {
    expect(parseAssessment('{"findings":["REDNESS"," Swelling "]}')?.findings).toEqual([
      'redness',
      'swelling',
    ]);
  });

  it('digs the object out of a code fence', () => {
    expect(parseAssessment('```json\n{"findings":["swelling"]}\n```')?.findings).toEqual([
      'swelling',
    ]);
  });

  /**
   * A photo that was not assessed stays unassessed — which is exactly how every
   * photo started, and a state the queue already knows how to show.
   */
  it('returns nothing for an answer it cannot read', () => {
    for (const raw of ['', 'Yara enfekte görünüyor.', '{}', '{"findings":"redness"}', '[1,2]']) {
      expect(parseAssessment(raw)).toBeNull();
    }
  });

  /**
   * A model that reports discharge and then says no review is needed has
   * contradicted itself, and the half worth acting on is the observation.
   */
  it('computes the flag from the findings rather than believing the model', () => {
    const parsed = parseAssessment('{"findings":["discharge"],"reviewSuggested":false}');

    expect(parsed?.reviewSuggested).toBe(true);
  });

  /**
   * No threshold and no confidence score. A threshold is a machine deciding a
   * wound is not worth a human's time.
   */
  it('flags on any finding at all', () => {
    expect(flagFrom([])).toBe(false);

    for (const finding of FINDINGS) {
      expect(flagFrom([finding])).toBe(true);
    }
  });

  it('knows which files it can look at', () => {
    expect(isAssessable('image/jpeg')).toBe(true);
    expect(isAssessable('IMAGE/PNG')).toBe(true);
    expect(isAssessable('application/pdf')).toBe(false);
    expect(isAssessable('image/heic')).toBe(false);
  });
});

describe('the assessment prompt', () => {
  /** The four red lines are asserted for every prompt in src/ai/red-lines.spec.ts. */
  it('forbids naming a condition', () => {
    expect(SYSTEM_PROMPT).toContain('Hastalık adı yazmazsın');
  });

  it('offers the vocabulary and nothing else', () => {
    for (const finding of FINDINGS) {
      expect(SYSTEM_PROMPT).toContain(finding);
    }

    expect(SYSTEM_PROMPT).toContain('listede olmayan hiçbir şey yazmazsın');
  });

  it('tells the model an unreadable photo is an empty list, not a guess', () => {
    expect(SYSTEM_PROMPT).toContain('boş liste döndür');
  });

  it('says the answer never reaches the patient', () => {
    expect(SYSTEM_PROMPT).toContain('hastaya gösterilmez');
  });

  /**
   * Redness on day two and on day ninety are different observations. Nothing
   * else goes: no name, no age, no note the patient wrote.
   */
  it('carries the days since surgery and the body area, and nothing else', () => {
    const prompt = buildUserPrompt({ daysSinceSurgery: 9, bodyArea: 'abdomen' });

    expect(prompt).toContain('9 gün');
    expect(prompt).toContain('abdomen');
    expect(prompt).not.toMatch(/ad|isim|telefon|mrn/i);
  });

  it('says so plainly when there is no operation on file', () => {
    expect(buildUserPrompt({ daysSinceSurgery: null, bodyArea: null })).toContain(
      'Ameliyat kaydı yok',
    );
  });
});

/**
 * The image travels as a content block, which is the first thing in this system
 * to send a model something other than words.
 */
describe('message content that is not text', () => {
  it('reads the text out of a mixed message for the leak check', () => {
    expect(
      textOf([
        { type: 'image', mediaType: 'image/jpeg', base64: 'AAAA' },
        { type: 'text', text: 'Bu fotoğrafta ne görüyorsun?' },
      ]),
    ).toBe('Bu fotoğrafta ne görüyorsun?');
  });

  it('leaves a plain string alone', () => {
    expect(textOf('merhaba')).toBe('merhaba');
  });

  /**
   * The limit that matters most is the one this cannot check: a face or a
   * tattoo in a wound photograph is an identifier no text scan will find. That
   * is why sending photographs is its own switch, off by default.
   */
  it('has no text at all to scan in an image-only message', () => {
    expect(textOf([{ type: 'image', mediaType: 'image/jpeg', base64: 'AAAA' }])).toBe('');
  });

  it('caps an image at a size the providers accept', () => {
    expect(MAX_IMAGE_BYTES).toBe(4 * 1024 * 1024);
  });
});
