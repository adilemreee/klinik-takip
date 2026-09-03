import { TriageLevel } from '@prisma/client';
import { screen, RED_FLAGS, foldForMatch } from './red-flags';
import { hasContent, needsImmediateAttention, parseVerdict, raiseTo, renderSummary } from './triage';
import { SYSTEM_PROMPT, buildUserPrompt } from './triage.prompt';

/**
 * The rule that makes it safe to put a model in this path (spec section 14.3).
 *
 * The dangerous half of "nothing critical is left to the AI alone" is not what
 * happens after a critical classification. It is the model reading "göğsüm
 * ağrıyor", answering INFO, and the message dropping into a pile nobody reads.
 */
describe('the triage floor', () => {
  it('lets the model raise the level', () => {
    expect(raiseTo(TriageLevel.ROUTINE, TriageLevel.URGENT)).toBe(TriageLevel.URGENT);
    expect(raiseTo(TriageLevel.ROUTINE, TriageLevel.EMERGENCY)).toBe(TriageLevel.EMERGENCY);
  });

  it('never lets the model lower it', () => {
    expect(raiseTo(TriageLevel.EMERGENCY, TriageLevel.INFO)).toBe(TriageLevel.EMERGENCY);
    expect(raiseTo(TriageLevel.URGENT, TriageLevel.ROUTINE)).toBe(TriageLevel.URGENT);
    expect(raiseTo(TriageLevel.ROUTINE, TriageLevel.INFO)).toBe(TriageLevel.ROUTINE);
  });

  /**
   * A model that is off, unpaid for, rate-limited, timed out or talked out of
   * its instructions by the message it is reading leaves the clinic exactly
   * where it would have been without it.
   */
  it('leaves the floor standing when there is no answer at all', () => {
    expect(raiseTo(TriageLevel.URGENT, null)).toBe(TriageLevel.URGENT);
    expect(raiseTo(TriageLevel.ROUTINE, null)).toBe(TriageLevel.ROUTINE);
  });

  it('knows which levels put a notification on a phone', () => {
    expect(needsImmediateAttention(TriageLevel.EMERGENCY)).toBe(true);
    expect(needsImmediateAttention(TriageLevel.URGENT)).toBe(true);
    expect(needsImmediateAttention(TriageLevel.ROUTINE)).toBe(false);
    expect(needsImmediateAttention(TriageLevel.INFO)).toBe(false);
  });
});

/**
 * The pass that runs whether or not the AI does. It ships enabled, and the AI
 * does not.
 */
describe('the keyword screen', () => {
  const level = (text: string): TriageLevel => screen(text).level;

  it('puts an ordinary question in front of a human and no higher', () => {
    expect(level('Merhaba, yarın duş alabilir miyim?')).toBe(TriageLevel.ROUTINE);
    expect(level('İlacımı yemekten önce mi sonra mı almalıyım?')).toBe(TriageLevel.ROUTINE);
  });

  /**
   * Never INFO. Deciding that something needs no human at all is a decision
   * this screen is nowhere near good enough to make.
   */
  it('never decides a message needs nobody', () => {
    expect(level('')).toBe(TriageLevel.ROUTINE);
    expect(level('teşekkürler')).toBe(TriageLevel.ROUTINE);
  });

  it('catches the things that cannot wait', () => {
    expect(level('nefes alamıyorum')).toBe(TriageLevel.EMERGENCY);
    expect(level('göğsüm ağrıyor')).toBe(TriageLevel.EMERGENCY);
    expect(level('kanama durmuyor ne yapayım')).toBe(TriageLevel.EMERGENCY);
    expect(level('bayıldım ve şimdi kalktım')).toBe(TriageLevel.EMERGENCY);
  });

  it('catches post-operative complications as urgent', () => {
    expect(level('yarada akıntı var ve kötü koku geliyor')).toBe(TriageLevel.URGENT);
    expect(level('ateşim 38.5 çıktı')).toBe(TriageLevel.URGENT);
    expect(level('sol bacağım şişti ve baldırımda ağrı var')).toBe(TriageLevel.URGENT);
  });

  /**
   * A patient typing without a Turkish keyboard writes "alamiyorum"; one with a
   * Turkish keyboard writes "alamıyorum". The clinical content is identical.
   */
  it('reads a message typed without Turkish characters', () => {
    expect(level('nefes alamiyorum')).toBe(TriageLevel.EMERGENCY);
    expect(level('gogsum agriyor')).toBe(TriageLevel.EMERGENCY);
    expect(level('YARADA AKINTI VAR')).toBe(TriageLevel.URGENT);
  });

  it('reads the same message in English', () => {
    expect(level("I can't breathe")).toBe(TriageLevel.EMERGENCY);
    expect(level('I have chest pain')).toBe(TriageLevel.EMERGENCY);
    expect(level('the wound has discharge and a foul smell')).toBe(TriageLevel.URGENT);
  });

  it('lets an emergency phrase win over an urgent one in the same message', () => {
    const result = screen('Ateşim 38 ve nefes alamıyorum');

    expect(result.level).toBe(TriageLevel.EMERGENCY);
    expect(result.matched).toContain('breathing');
    expect(result.matched).toContain('fever');
  });

  /** Ids, so a match can be shown and audited without the patient's own words. */
  it('records what matched by id, never by phrase', () => {
    const { matched } = screen('göğsüm ağrıyor');

    expect(matched).toEqual(['chest-pain']);
  });

  it('escalates a message about self-harm', () => {
    expect(level('artık yaşamak istemiyorum')).toBe(TriageLevel.EMERGENCY);
  });

  it('has no malformed entries', () => {
    for (const flag of RED_FLAGS) {
      expect(flag.id).toMatch(/^[a-z-]+$/);
      expect(flag.stems.length).toBeGreaterThan(0);

      for (const stem of flag.stems) {
        // Stems are matched against folded text, so a stem that is not itself
        // folded can never match anything.
        expect(stem).toBe(foldForMatch(stem));
      }
    }
  });
});

/**
 * Reading the model's answer. Every failure here has to mean "no contribution",
 * because the alternative — a default level — is a parser quietly deciding
 * nobody needs to read the message.
 */
describe('parsing the verdict', () => {
  it('reads a well-formed answer', () => {
    const verdict = parseVerdict(
      '{"triage":"URGENT","complaint":"yarada akıntı","measurements":"ateş 38.5","duration":"2 gün"}',
    );

    expect(verdict?.level).toBe(TriageLevel.URGENT);
    expect(verdict?.summary.complaint).toBe('yarada akıntı');
  });

  it('digs the object out of a code fence and a sentence', () => {
    const verdict = parseVerdict(
      'Tabii, işte değerlendirme:\n```json\n{"triage":"INFO","complaint":"soru"}\n```\nUmarım yardımcı olur.',
    );

    expect(verdict?.level).toBe(TriageLevel.INFO);
  });

  it('handles a brace inside a string without stopping early', () => {
    const verdict = parseVerdict('{"triage":"ROUTINE","complaint":"şöyle dedi: \\"} bitti\\"","duration":""}');

    expect(verdict?.level).toBe(TriageLevel.ROUTINE);
    expect(verdict?.summary.complaint).toContain('bitti');
  });

  it('returns nothing for a level the model invented', () => {
    expect(parseVerdict('{"triage":"CRITICAL","complaint":"x"}')).toBeNull();
    expect(parseVerdict('{"triage":"","complaint":"x"}')).toBeNull();
  });

  it('returns nothing for an answer it cannot read', () => {
    for (const raw of ['', 'Bilmiyorum.', '{"triage":', 'null', '{}', '[1,2]']) {
      expect(parseVerdict(raw)).toBeNull();
    }
  });

  /**
   * The failure that matters: an unreadable answer must not become INFO. A
   * parser with a default has quietly become the thing that decides nobody
   * needs to read the message.
   */
  it('has no default level to fall back to', () => {
    expect(parseVerdict('bir şeyler ters gitti')).toBeNull();
    expect(raiseTo(TriageLevel.ROUTINE, parseVerdict('bir şeyler ters gitti')?.level ?? null)).toBe(
      TriageLevel.ROUTINE,
    );
  });

  it('accepts a lowercase level, because models do that', () => {
    expect(parseVerdict('{"triage":"urgent"}')?.level).toBe(TriageLevel.URGENT);
  });

  it('knows when a summary says nothing worth showing', () => {
    expect(hasContent({ complaint: '', measurements: '', duration: '' })).toBe(false);
    expect(hasContent({ complaint: 'ağrı', measurements: '', duration: '' })).toBe(true);
  });

  it('renders the three lines the specification asks for', () => {
    const rendered = renderSummary({ complaint: 'yarada akıntı', measurements: '', duration: '2 gün' });

    expect(rendered.split('\n')).toEqual([
      'Şikayet: yarada akıntı',
      'Ölçülen değerler: —',
      'Süre: 2 gün',
    ]);
  });
});

/**
 * M4 fixes these in the system prompt and says they are verified by tests.
 *
 * A prompt is a request, not a control — the model can be talked out of it by
 * the message it is reading. What these assertions buy is that a later edit
 * cannot quietly drop a line.
 */
describe('the fixed rules in the system prompt', () => {
  // The four clauses of section 14 are asserted once, for every prompt, in
  // `src/ai/red-lines.spec.ts`. What is left here is what only this prompt says.
  it('tells the model to choose the higher level when unsure', () => {
    expect(SYSTEM_PROMPT).toContain('YÜKSEK');
  });

  it('explains the redaction placeholders, so they are not read as the patient\'s words', () => {
    expect(SYSTEM_PROMPT).toContain('[ad]');
    expect(SYSTEM_PROMPT).toContain('kimlik bilgileridir');
  });

  it('asks for every level it is allowed to answer with', () => {
    for (const level of Object.values(TriageLevel)) {
      expect(SYSTEM_PROMPT).toContain(level);
    }
  });
});

describe('the user prompt', () => {
  /** "Yarada akıntı var" on day two and on day ninety are different messages. */
  it('carries the days since surgery, because they change what the message means', () => {
    const prompt = buildUserPrompt('yarada akıntı var', {
      daysSinceSurgery: 9,
      procedureName: 'Sleeve gastrektomi',
      age: 45,
      sex: 'FEMALE',
    });

    expect(prompt).toContain('yarada akıntı var');
    expect(prompt).toContain('9 gün');
    expect(prompt).toContain('Sleeve gastrektomi');
  });

  it('says so plainly when there is no operation on file', () => {
    const prompt = buildUserPrompt('merhaba', {
      daysSinceSurgery: null,
      procedureName: null,
      age: null,
      sex: null,
    });

    expect(prompt).toContain('Ameliyat kaydı yok');
    expect(prompt).toContain('bilinmiyor');
  });

  /** The whole patient record the model gets, and it is four lines. */
  it('carries nothing that could identify the patient', () => {
    const prompt = buildUserPrompt('merhaba', {
      daysSinceSurgery: 9,
      procedureName: 'Sleeve gastrektomi',
      age: 45,
      sex: 'FEMALE',
    });

    expect(prompt).not.toMatch(/mrn|dosya no|telefon|e-posta/i);
  });
});
