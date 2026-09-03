/**
 * Deciding whether there is enough in the corpus to answer at all (spec M4).
 *
 * The rule is that the assistant answers **only** from the clinic's own
 * documents. That rule is not kept by asking the model nicely; it is kept here,
 * by refusing to call the model when retrieval came back thin. A bot with
 * nothing to quote and an instruction to be helpful will be helpful from its
 * training data, and the clinic will find out when a patient repeats it back.
 */

export interface Retrieved {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  /** 0–1. Cosine similarity, lexical rank, or the higher of the two. */
  score: number;
  via: 'vector' | 'lexical' | 'both';
}

/**
 * How close a chunk has to be before it counts as evidence.
 *
 * Deliberately not low. Every point below this is a chunk that is *sort of*
 * about the question, and a handful of sort-of chunks is exactly the input that
 * produces a confident wrong answer. When nothing clears it the assistant says
 * so and a person takes over, which is the outcome the specification asks for
 * when the bot is unsure.
 */
export const SCORE_FLOOR = 0.35;

/** More than this and the prompt is mostly context the question did not need. */
export const MAX_CHUNKS = 6;

/**
 * One ranked list from two searches.
 *
 * A chunk found by both is worth more than a chunk found by either — the two
 * searches fail in different ways, and agreement between them is the closest
 * thing to a second opinion available here.
 */
export function merge(vector: Retrieved[], lexical: Retrieved[]): Retrieved[] {
  const byChunk = new Map<string, Retrieved>();

  for (const hit of vector) {
    byChunk.set(hit.chunkId, { ...hit, via: 'vector' });
  }

  for (const hit of lexical) {
    const existing = byChunk.get(hit.chunkId);

    if (!existing) {
      byChunk.set(hit.chunkId, { ...hit, via: 'lexical' });
      continue;
    }

    byChunk.set(hit.chunkId, {
      ...existing,
      score: Math.min(1, Math.max(existing.score, hit.score) + AGREEMENT_BONUS),
      via: 'both',
    });
  }

  return [...byChunk.values()].sort((a, b) => b.score - a.score);
}

/** Small: agreement is evidence, not proof. */
export const AGREEMENT_BONUS = 0.1;

/**
 * `ts_rank` on the same scale as cosine similarity.
 *
 * The two numbers are not comparable as they come: cosine similarity for a
 * relevant passage sits around 0.4–0.8, while `ts_rank` for the same passage is
 * a few hundredths. Ranking them together without this would let any vector hit
 * bury every lexical one, and with embeddings switched off — which is how this
 * ships — the floor would reject the entire corpus.
 *
 * A saturating map rather than a normalisation by the result set's maximum:
 * dividing by the best hit makes the best hit 1.0 even when it is poor, which
 * is exactly the case the floor exists to catch.
 */
export const LEXICAL_HALF_POINT = 0.06;

/**
 * Characters folded on both sides of the lexical search.
 *
 * The index is built over the same `translate`, so a patient typing
 * "pansuman degistirme" on a keyboard without Turkish characters matches a
 * document that says "pansumanınızı değiştirin" — and so does a patient who
 * types it properly.
 */
export const FOLD_FROM = 'ıİşŞğĞüÜöÖçÇâÂîÎûÛ';
export const FOLD_TO = 'iIsSgGuUoOcCaAiIuU';

/** The same fold the index applies, done here so both sides meet. */
export function fold(value: string): string {
  let folded = '';

  for (const character of value) {
    const at = FOLD_FROM.indexOf(character);
    folded += at === -1 ? character : FOLD_TO[at]!;
  }

  return folded;
}

/**
 * How much of a word survives into the search.
 *
 * Turkish glues its endings on: the protocol says "pansumanınızı
 * değiştirin" and the patient asks "pansuman ne sıklıkla değiştirilmeli".
 * Nothing matches whole-word, and PostgreSQL ships no Turkish stemmer.
 *
 * Truncating to a prefix is stemming by brute force, and it is the technique
 * that actually works for an agglutinative language without a dictionary. Six
 * characters keeps "değiş" from "değiştirilmeli" and "değiştirin" — the same
 * stem — while staying long enough that "yara" and "yardım" do not collide.
 */
export const STEM_LENGTH = 6;

/**
 * Words too common to say anything about which passage is relevant.
 *
 * Folded at load, because the terms they are compared against have already been
 * folded — a list written as "için" would never match the "icin" that reaches
 * it, and every stopword would sail through.
 */
const STOPWORDS = new Set(
  [
    'bir', 'bu', 'şu', 'ne', 'nasıl', 'için', 'ile', 'mi', 'mı', 'mu', 'mü',
    'var', 'yok', 'ben', 'siz', 'and', 'the', 'for', 'can', 'what', 'how',
  ].map((word) => fold(word)),
);

/**
 * The patient's question as a tsquery: prefixes, joined with OR.
 *
 * OR rather than AND because an AND query needs every word of the question to
 * appear in one chunk, which almost never happens and would make the assistant
 * hand over everything. The score floor and the model's own "do these passages
 * answer it" check are what keep recall from becoming noise.
 */
export function buildTsQuery(question: string): string {
  const terms = fold(question)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 3 && !STOPWORDS.has(term))
    .map((term) => term.slice(0, STEM_LENGTH))
    // Only letters and digits survive the split, so nothing here can carry
    // tsquery syntax into the query.
    .filter((term) => term.length >= 3);

  return [...new Set(terms)].map((term) => `${term}:*`).join(' | ');
}

export function lexicalScore(rank: number): number {
  if (!Number.isFinite(rank) || rank <= 0) return 0;

  return rank / (rank + LEXICAL_HALF_POINT);
}

export interface Evidence {
  chunks: Retrieved[];
  /** False when the corpus had nothing to say and a person should answer. */
  sufficient: boolean;
}

export function select(hits: Retrieved[]): Evidence {
  const chunks = hits.filter((hit) => hit.score >= SCORE_FLOOR).slice(0, MAX_CHUNKS);

  return { chunks, sufficient: chunks.length > 0 };
}

/** The retrieved passages as the prompt sees them, numbered so they can be cited. */
export function renderSources(chunks: Retrieved[]): string {
  return chunks
    .map((chunk, index) => `[${index + 1}] ${chunk.documentTitle}\n${chunk.content}`)
    .join('\n\n---\n\n');
}

/**
 * The citations an answer claims, read back as indexes into what was retrieved.
 *
 * An answer that cites nothing, or cites a passage that was not in front of it,
 * is an answer from somewhere other than the corpus — which is the one thing
 * this assistant is not allowed to produce.
 */
export function citedChunks(citations: number[], chunks: Retrieved[]): Retrieved[] {
  const seen = new Set<number>();

  return citations
    .filter((citation) => {
      const valid = Number.isInteger(citation) && citation >= 1 && citation <= chunks.length;
      if (!valid || seen.has(citation)) return false;
      seen.add(citation);
      return true;
    })
    .map((citation) => chunks[citation - 1]!);
}
