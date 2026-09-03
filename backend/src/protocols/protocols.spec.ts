import { MIN_CHARS, OVERLAP_CHARS, TARGET_CHARS, chunk, hardSplit } from './chunking';
import {
  AGREEMENT_BONUS,
  MAX_CHUNKS,
  SCORE_FLOOR,
  buildTsQuery,
  citedChunks,
  fold,
  lexicalScore,
  merge,
  renderSources,
  select,
  type Retrieved,
} from './retrieval';
import { SYSTEM_PROMPT, buildUserPrompt, parseAnswer } from '../assistant/assistant.prompt';

const hit = (chunkId: string, score: number, title = 'Protokol'): Retrieved => ({
  chunkId,
  documentId: 'd1',
  documentTitle: title,
  content: `${chunkId} içeriği`,
  score,
  via: 'vector',
});

/**
 * Chunking, where most of a retrieval system's quality is decided and which is
 * usually treated as plumbing.
 */
describe('splitting a protocol document', () => {
  it('keeps a short document in one piece', () => {
    const text = 'Ameliyattan sonra ilk 48 saat yarayı ıslatmayın. Duş almadan önce doktorunuza sorun.';

    expect(chunk(text)).toEqual([{ index: 0, content: text }]);
  });

  it('splits on the document\'s own paragraphs before anything else', () => {
    const paragraphs = [
      'A'.repeat(900),
      'B'.repeat(900),
      'C'.repeat(900),
    ].join('\n\n');

    const pieces = chunk(paragraphs);

    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.content.length).toBeLessThanOrEqual(TARGET_CHARS + OVERLAP_CHARS + 10);
    }
  });

  /**
   * The instruction and its caveat have to stay together. "Yarayı sabunla
   * yıkayın" and "ilk 48 saat ıslatmayın" in two different chunks is how a bot
   * ends up telling somebody the opposite of the protocol.
   */
  it('carries the tail of one chunk into the next', () => {
    const text = Array.from({ length: 6 }, (_, index) => `Paragraf ${index}. ${'x'.repeat(400)}`).join(
      '\n\n',
    );

    const pieces = chunk(text);

    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces[1]!.content.startsWith('…')).toBe(true);
  });

  it('numbers the pieces in order', () => {
    const pieces = chunk(Array.from({ length: 8 }, () => 'y'.repeat(500)).join('\n\n'));

    expect(pieces.map((piece) => piece.index)).toEqual(pieces.map((_, index) => index));
  });

  it('drops fragments that are only a heading or a page number', () => {
    expect(chunk('Bölüm 3')).toEqual([]);
    expect(chunk('   \n\n  \n')).toEqual([]);
  });

  it('splits a paragraph on sentence ends rather than mid-word', () => {
    const sentence = 'Bu bir cümledir ve yeterince uzundur. ';
    const pieces = chunk(sentence.repeat(60));

    for (const piece of pieces) {
      // Every piece ends where a sentence does, or where the overlap marker is.
      expect(piece.content.trimEnd()).toMatch(/[.…]$|uzundur$/);
    }
  });

  it('hard-splits a page with no structure at all', () => {
    const parts = hardSplit('z'.repeat(2_500));

    expect(parts).toHaveLength(3);
    expect(parts.join('')).toHaveLength(2_500);
  });

  it('never emits a piece below the fragment threshold', () => {
    for (const piece of chunk(Array.from({ length: 12 }, () => 'w'.repeat(430)).join('\n\n'))) {
      expect(piece.content.length).toBeGreaterThanOrEqual(MIN_CHARS);
    }
  });
});

/**
 * Retrieval, and the decision that keeps the assistant honest: whether there is
 * enough in the corpus to answer at all.
 */
describe('ranking what was found', () => {
  it('rewards a chunk both searches agree on', () => {
    const merged = merge([hit('c1', 0.5)], [{ ...hit('c1', 0.4), via: 'lexical' }]);

    expect(merged[0]!.via).toBe('both');
    expect(merged[0]!.score).toBeCloseTo(0.5 + AGREEMENT_BONUS, 5);
  });

  it('keeps a chunk only one search found', () => {
    const merged = merge([hit('c1', 0.6)], [{ ...hit('c2', 0.5), via: 'lexical' }]);

    expect(merged.map((chunkHit) => chunkHit.chunkId)).toEqual(['c1', 'c2']);
    expect(merged[0]!.via).toBe('vector');
    expect(merged[1]!.via).toBe('lexical');
  });

  it('never lets agreement push a score past one', () => {
    const merged = merge([hit('c1', 0.99)], [{ ...hit('c1', 0.99), via: 'lexical' }]);

    expect(merged[0]!.score).toBeLessThanOrEqual(1);
  });

  it('works with either search returning nothing', () => {
    expect(merge([], [{ ...hit('c1', 0.5), via: 'lexical' }])).toHaveLength(1);
    expect(merge([hit('c1', 0.5)], [])).toHaveLength(1);
    expect(merge([], [])).toEqual([]);
  });

  /**
   * The rule the whole feature rests on. A handful of sort-of relevant chunks
   * is exactly the input that produces a confident wrong answer, so below the
   * floor the assistant does not answer at all.
   */
  it('says there is nothing to answer from when everything is weak', () => {
    const evidence = select([hit('c1', SCORE_FLOOR - 0.01), hit('c2', 0.1)]);

    expect(evidence.sufficient).toBe(false);
    expect(evidence.chunks).toEqual([]);
  });

  it('answers from what clears the floor and drops the rest', () => {
    const evidence = select([hit('c1', 0.8), hit('c2', SCORE_FLOOR), hit('c3', 0.2)]);

    expect(evidence.sufficient).toBe(true);
    expect(evidence.chunks.map((chunkHit) => chunkHit.chunkId)).toEqual(['c1', 'c2']);
  });

  it('does not send more context than the question needed', () => {
    const many = Array.from({ length: 20 }, (_, index) => hit(`c${index}`, 0.9));

    expect(select(many).chunks).toHaveLength(MAX_CHUNKS);
  });

  /**
   * Cosine similarity and ts_rank are not on the same scale. Without this the
   * lexical half — which is the only half running while embeddings are off —
   * would never clear the floor.
   */
  it('puts a lexical rank on the same scale as a cosine similarity', () => {
    expect(lexicalScore(0)).toBe(0);
    expect(lexicalScore(-1)).toBe(0);
    expect(lexicalScore(0.06)).toBeCloseTo(0.5, 5);
    expect(lexicalScore(0.3)).toBeGreaterThan(SCORE_FLOOR);
    expect(lexicalScore(0.001)).toBeLessThan(SCORE_FLOOR);
    expect(lexicalScore(10)).toBeLessThanOrEqual(1);
  });

  it('numbers the sources so an answer can point at them', () => {
    const rendered = renderSources([hit('c1', 0.9, 'Sleeve Bakım'), hit('c2', 0.8, 'Genel SSS')]);

    expect(rendered).toContain('[1] Sleeve Bakım');
    expect(rendered).toContain('[2] Genel SSS');
  });
});

/**
 * The citation check: an answer citing nothing, or citing a passage that was
 * not in front of it, came from somewhere other than the corpus.
 */
describe('reading an answer\'s citations', () => {
  const chunks = [hit('c1', 0.9), hit('c2', 0.8)];

  it('resolves the numbers to the passages that were sent', () => {
    expect(citedChunks([1, 2], chunks).map((c) => c.chunkId)).toEqual(['c1', 'c2']);
  });

  it('drops a citation to a passage that was never sent', () => {
    expect(citedChunks([3, 0, -1, 99], chunks)).toEqual([]);
  });

  it('drops a repeated citation', () => {
    expect(citedChunks([1, 1, 1], chunks)).toHaveLength(1);
  });

  it('drops something that is not a whole number', () => {
    expect(citedChunks([1.5, Number.NaN], chunks)).toEqual([]);
  });

  it('is empty for an answer that cited nothing', () => {
    expect(citedChunks([], chunks)).toEqual([]);
  });
});

describe('reading the assistant\'s reply', () => {
  it('reads an answer with its citations', () => {
    const parsed = parseAnswer('{"answered":true,"answer":"İlk 48 saat ıslatmayın.","citations":[1]}');

    expect(parsed?.answered).toBe(true);
    expect(parsed?.citations).toEqual([1]);
  });

  it('reads a refusal with its reason', () => {
    const parsed = parseAnswer(
      '{"answered":false,"answer":"","citations":[],"handoverReason":"Dokümanlarda bu yok."}',
    );

    expect(parsed?.answered).toBe(false);
    expect(parsed?.handoverReason).toContain('Dokümanlarda');
  });

  /** An answer with no text is not an answer, however confidently it was labelled one. */
  it('refuses an empty answer that claims to be one', () => {
    expect(parseAnswer('{"answered":true,"answer":"   ","citations":[1]}')?.answered).toBe(false);
  });

  it('returns nothing for a reply it cannot read', () => {
    for (const raw of ['', 'Bilmiyorum', '[1,2]', '{"answered":']) {
      expect(parseAnswer(raw)).toBeNull();
    }
  });

  it('digs the object out of a code fence', () => {
    expect(
      parseAnswer('```json\n{"answered":true,"answer":"Evet.","citations":[2]}\n```')?.answer,
    ).toBe('Evet.');
  });
});

describe('the assistant system prompt', () => {
  /** The four red lines are asserted for every prompt in src/ai/red-lines.spec.ts. */
  it('forbids the model using anything but the passages it was given', () => {
    expect(SYSTEM_PROMPT).toContain('YALNIZCA');
    expect(SYSTEM_PROMPT).toContain('kendi genel');
  });

  it('tells the model to hand over when the passages do not answer the question', () => {
    expect(SYSTEM_PROMPT).toContain('insana devredersin');
  });

  it('asks for citations', () => {
    expect(SYSTEM_PROMPT).toContain('citations');
  });

  it('puts the passages and the question in the user prompt', () => {
    const prompt = buildUserPrompt('Duş alabilir miyim?', '[1] Bakım\nİlk 48 saat…', {
      daysSinceSurgery: 3,
      procedureName: 'Sleeve gastrektomi',
    });

    expect(prompt).toContain('Duş alabilir miyim?');
    expect(prompt).toContain('[1] Bakım');
    expect(prompt).toContain('3 gün');
  });
});

/**
 * Turning a patient's question into a search.
 *
 * Turkish glues its endings on and half of everyone types without diacritics.
 * Both are ordinary rather than exotic, and either one alone is enough to make
 * a whole-word search return nothing for every question ever asked.
 */
describe('building the lexical query', () => {
  it('stems by truncation, because there is no Turkish stemmer to use', () => {
    // "değiştirilmeli" and "değiştirin" are the same instruction.
    expect(buildTsQuery('değiştirilmeli')).toBe('degist:*');
    expect(buildTsQuery('değiştirin')).toBe('degist:*');
  });

  it('folds the diacritics, so both ways of typing reach the same passage', () => {
    expect(buildTsQuery('pansuman degistirme')).toBe(buildTsQuery('pansuman değiştirme'));
  });

  it('joins the terms with OR', () => {
    // An AND query needs every word of the question in one chunk, which almost
    // never happens — the assistant would hand over everything.
    expect(buildTsQuery('pansuman yara')).toBe('pansum:* | yara:*');
  });

  it('drops words too common to say which passage is relevant', () => {
    expect(buildTsQuery('bu ne için nasıl')).toBe('');
  });

  it('drops a term too short to stem', () => {
    expect(buildTsQuery('ne ve mi')).toBe('');
  });

  it('does not repeat a term the question used twice', () => {
    expect(buildTsQuery('pansuman pansumanı pansumanınızı')).toBe('pansum:*');
  });

  /** Only letters and digits survive the split, so nothing can carry tsquery syntax in. */
  it('cannot be talked into a tsquery of its own', () => {
    const built = buildTsQuery("yara & !bakım | (something) ' ; drop");

    expect(built).not.toMatch(/[&!()';]/);
    expect(built.split(' | ').every((term) => /^[\p{L}\p{N}]+:\*$/u.test(term))).toBe(true);
  });

  it('is empty for a question with nothing searchable in it', () => {
    expect(buildTsQuery('??? !!!')).toBe('');
    expect(buildTsQuery('')).toBe('');
  });

  it('folds exactly what the index folds', () => {
    expect(fold('ıİşŞğĞüÜöÖçÇ')).toBe('iIsSgGuUoOcC');
    expect(fold('abc')).toBe('abc');
  });
});
