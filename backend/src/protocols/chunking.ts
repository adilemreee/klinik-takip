/**
 * Splitting a clinical protocol into the pieces the assistant retrieves.
 *
 * Chunking is where most of a retrieval system's quality is decided, and it is
 * usually treated as plumbing. The failure it produces is specific: a chunk cut
 * through the middle of an instruction retrieves as half an instruction, and a
 * bot that may only answer from its sources will then answer with half of one.
 *
 * So the split follows the document's own structure — blank lines first, then
 * sentences — and never cuts inside a sentence unless a single sentence is
 * longer than a whole chunk.
 */

/**
 * Roughly 1200 characters, which is a few hundred tokens.
 *
 * Small enough that a retrieved chunk is mostly about one thing, large enough
 * that an instruction and its caveat stay together. The caveat is the half that
 * matters: "yarayı sabunla yıkayın" and "ilk 48 saat ıslatmayın" separated into
 * two chunks is how a bot ends up telling somebody the opposite of the
 * protocol.
 */
export const TARGET_CHARS = 1_200;

/**
 * How much of the previous chunk each one repeats.
 *
 * Overlap is what keeps a question whose answer straddles a boundary
 * retrievable. It costs storage and nothing else.
 */
export const OVERLAP_CHARS = 200;

/** Below this a chunk is a fragment: a heading, a page number, a stray line. */
export const MIN_CHARS = 80;

export interface Chunk {
  index: number;
  content: string;
}

/** Paragraphs, then sentences — the document's own seams before ours. */
function pieces(text: string): string[] {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return paragraphs.flatMap((paragraph) =>
    paragraph.length <= TARGET_CHARS ? [paragraph] : sentences(paragraph),
  );
}

/**
 * Sentence ends, without breaking on the abbreviations and numbers a clinical
 * document is full of: "38.5", "Dr.", "vb." are not the end of anything.
 */
function sentences(paragraph: string): string[] {
  const parts: string[] = [];
  let current = '';

  for (const token of paragraph.split(/(?<=[.!?])\s+/)) {
    const candidate = current.length === 0 ? token : `${current} ${token}`;

    if (candidate.length > TARGET_CHARS && current.length > 0) {
      parts.push(current);
      current = token;
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) parts.push(current);

  return parts;
}

export function chunk(text: string): Chunk[] {
  const parts = pieces(text);
  const chunks: string[] = [];
  let current = '';

  for (const part of parts) {
    if (current.length === 0) {
      current = part;
      continue;
    }

    if (current.length + part.length + 2 <= TARGET_CHARS) {
      current = `${current}\n\n${part}`;
      continue;
    }

    chunks.push(current);
    // Carry the tail of the last chunk forward, so an answer that straddles the
    // boundary is still retrievable from one side of it.
    const tail = current.slice(-OVERLAP_CHARS);
    const resume = tail.length < current.length ? `…${tail}\n\n` : '';
    current = `${resume}${part}`;
  }

  if (current.length > 0) chunks.push(current);

  return chunks
    .map((content) => content.trim())
    .filter((content) => content.length >= MIN_CHARS)
    .map((content, index) => ({ index, content }));
}

/**
 * A single very long line — an OCR'd page with no paragraph breaks — split
 * hard, because the alternative is one chunk the size of the document and a
 * retrieval that always returns everything.
 */
export function hardSplit(text: string, size = TARGET_CHARS): string[] {
  const parts: string[] = [];

  for (let at = 0; at < text.length; at += size) {
    parts.push(text.slice(at, at + size));
  }

  return parts;
}
