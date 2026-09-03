import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The font the PDFs are drawn with.
 *
 * PDF's built-in fonts are WinAnsi-encoded, which has no ş, ğ, İ or ı. A
 * Turkish patient summary rendered in Helvetica does not fail — it silently
 * drops or mangles the letters, and "Ayşe Yılmaz" comes out as something the
 * patient would not recognise as their own name. So a Unicode TTF is embedded,
 * and `fontCovers` is tested against the whole Turkish alphabet.
 *
 * DejaVu Sans: permissive licence (Bitstream Vera + Arev), broad Latin
 * coverage, and small enough to embed a subset of per document.
 */

function resolveFontDirectory(): string {
  // Resolved through the package rather than a hard-coded path, so a hoisted
  // or nested node_modules layout both work.
  const manifest = require.resolve('dejavu-fonts-ttf/package.json');

  return join(dirname(manifest), 'ttf');
}

export interface FontSet {
  regular: string;
  bold: string;
}

export class FontMissingError extends Error {}

/**
 * Fails when a font file is not where it should be.
 *
 * Loudly, and before anything is drawn: a missing TTF does not stop pdfkit, it
 * makes it fall back — and a clinical summary rendered in empty boxes is worse
 * than no summary at all, because somebody will print it.
 */
export function verify(set: FontSet): FontSet {
  for (const weight of Object.keys(set) as (keyof FontSet)[]) {
    const path = set[weight];

    if (!existsSync(path)) {
      throw new FontMissingError(`Font missing: ${weight} at ${path}`);
    }
  }

  return set;
}

let cached: FontSet | null = null;

export function fonts(): FontSet {
  if (cached) return cached;

  const directory = resolveFontDirectory();

  cached = verify({
    regular: join(directory, 'DejaVuSans.ttf'),
    bold: join(directory, 'DejaVuSans-Bold.ttf'),
  });

  return cached;
}

/** Every letter Turkish needs, plus the punctuation a summary uses. */
export const TURKISH_ALPHABET = 'abcçdefgğhıijklmnoöprsştuüvyzABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ';
