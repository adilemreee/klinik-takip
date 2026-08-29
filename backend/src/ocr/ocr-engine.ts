/** One word as the engine read it, with how sure it is. */
export interface OcrWord {
  text: string;
  /** 0..1. Below the review threshold the field is shown for confirmation. */
  confidence: number;
  line: number;
}

export interface OcrPage {
  /** Words grouped into lines, in reading order. */
  lines: OcrLine[];
}

export interface OcrLine {
  text: string;
  /** The lowest confidence of any word on the line — the weakest link. */
  confidence: number;
  words: OcrWord[];
}

/**
 * Reading text off an image.
 *
 * An interface because the engine is the least interesting part and the most
 * awkward to run: the value in this module is what happens to the text
 * afterwards, and that has to be testable without a binary on the path.
 */
export interface OcrEngine {
  recognise(imagePath: string, languages?: string[]): Promise<OcrPage>;
}

/**
 * Groups engine words into lines.
 *
 * Shared by every engine implementation, and the reason line confidence is the
 * minimum rather than the mean: a line read as "Hemoglobin 13.5" where only
 * "13.5" is doubtful is a doubtful line. Averaging would hide the one word that
 * matters behind the several that do not.
 */
export function groupIntoLines(words: OcrWord[]): OcrLine[] {
  const byLine = new Map<number, OcrWord[]>();

  for (const word of words) {
    if (word.text.trim() === '') continue;

    const existing = byLine.get(word.line);
    if (existing) {
      existing.push(word);
    } else {
      byLine.set(word.line, [word]);
    }
  }

  return [...byLine.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, lineWords]) => ({
      text: lineWords.map((word) => word.text).join(' '),
      confidence: Math.min(...lineWords.map((word) => word.confidence)),
      words: lineWords,
    }));
}
