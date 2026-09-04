import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Copies the legal texts into the backend so the image can serve them.
 *
 * The Docker build context is `backend/`, so the repository's `docs/` is not
 * inside it. The alternative to this copy is a second hand-maintained version
 * of the privacy notice — and a privacy notice that exists twice is one that
 * will disagree with itself, discovered by whoever is holding the wrong half.
 *
 * So: one source, a generated copy, and a CI check that they match. The same
 * arrangement the design tokens and string catalogues already use.
 */
const DOCUMENTS = ['KVKK-AYDINLATMA-METNI.md'];

const root = join(__dirname, '..', '..');
const target = join(__dirname, '..', 'legal');

mkdirSync(target, { recursive: true });

for (const name of DOCUMENTS) {
  const to = join(target, name);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(root, 'docs', name), to);
  console.log(`legal/${name}`);
}
