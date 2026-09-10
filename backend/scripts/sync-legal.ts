import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
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

/**
 * Texts the clinic supplies, copied only if they exist.
 *
 * The treatment consent is the clinic's own document — its wording is a
 * medical-legal decision, not ours. Until the file is added the endpoint
 * answers 404 and the app does not offer signing, which is the only safe
 * behaviour: a placeholder that can be signed is worse than no form at all.
 */
const OPTIONAL_DOCUMENTS = ['TEDAVI-ONAM-METNI.md'];

const root = join(__dirname, '..', '..');
const target = join(__dirname, '..', 'legal');

mkdirSync(target, { recursive: true });

for (const name of DOCUMENTS) {
  const to = join(target, name);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(root, 'docs', name), to);
  console.log(`legal/${name}`);
}

for (const name of OPTIONAL_DOCUMENTS) {
  const from = join(root, 'docs', name);

  if (!existsSync(from)) {
    console.log(`legal/${name} — not supplied yet, skipped`);
    continue;
  }

  const to = join(target, name);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`legal/${name}`);
}
