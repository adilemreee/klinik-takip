import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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

const DOCUMENTS_ALSO = ['TEDAVI-ONAM-METNI.md'];

/**
 * Procedure-specific consent annexes, whichever ones exist.
 *
 * The base consent covers what every operation shares; the risks of *this*
 * operation are the clinic's to write, one file per procedure code, named
 * `TEDAVI-ONAM-<CODE>.md` and matched against the surgery record. A clinic
 * that has not written one yet still has a working form — with the general
 * risks and the hekim's own explanation, which is what the law actually
 * requires of the conversation.
 */
const ANNEX_PATTERN = /^TEDAVI-ONAM-(?!METNI\.md$).+\.md$/;

const root = join(__dirname, '..', '..');
const target = join(__dirname, '..', 'legal');

mkdirSync(target, { recursive: true });

const annexes = readdirSync(join(root, 'docs')).filter((name) => ANNEX_PATTERN.test(name));

for (const name of [...DOCUMENTS, ...DOCUMENTS_ALSO, ...annexes]) {
  const from = join(root, 'docs', name);

  if (!existsSync(from)) {
    console.log(`legal/${name} — not supplied, skipped`);
    continue;
  }

  const to = join(target, name);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`legal/${name}`);
}
