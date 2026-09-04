/**
 * Folding a name so search finds it however it was typed.
 *
 * A coordinator on a keyboard without a Turkish layout types "Ayse Yilmaz"; the
 * file says "Ayşe Yılmaz". ILIKE is case-insensitive and not accent-insensitive,
 * so before this the search found nothing — and in a clinic "no results" reads
 * as "this patient is not in the system", which is the worst answer a search can
 * give.
 *
 * Decomposition does most of the work — ş, ç, ö, ü, ğ and â all separate into a
 * base letter and a combining mark, so stripping the marks folds them. One
 * letter is left over and it is the important one; see [IRREDUCIBLE].
 *
 * This has to agree with the `translate()` in migration
 * 20260905000000_search_folds_turkish, which backfilled the existing rows.
 * `search-folding.spec.ts` compares the two directly, because a disagreement
 * would make some patients findable by one spelling and some by another with
 * nothing to say which.
 */
/**
 * The letters Unicode decomposition cannot reach.
 *
 * Almost every accented letter decomposes into a base letter plus a combining
 * mark, so stripping the marks folds it. **ı does not.** U+0131 is its own
 * letter with nothing to decompose, so NFD leaves it alone and "yilmaz" would
 * still miss "yılmaz" — which is the exact case this exists for. Its capital İ
 * needs no entry: lower-casing it already yields i plus a combining dot, which
 * the strip removes.
 */
const IRREDUCIBLE: Readonly<Record<string, string>> = {
  ı: 'i',
};

/** Combining marks, which is what decomposition separates out. */
const COMBINING = /\p{Mn}/gu;

/**
 * Lower-cases and folds.
 *
 * `toLowerCase()` and not a Turkish-locale lower-case: `'I'.toLocaleLowerCase('tr')`
 * is 'ı', which would send an English name typed in capitals through a letter
 * the fold then has to undo. A plain lower-case reaches the same answer from
 * either spelling.
 */
export function foldForSearch(value: string): string {
  const stripped = value.toLowerCase().normalize('NFD').replace(COMBINING, '');

  let folded = '';

  for (const character of stripped) {
    folded += IRREDUCIBLE[character] ?? character;
  }

  return folded;
}

/** The stored form: everything a search may match on, in one string. */
export function patientSearchText(parts: {
  firstName: string;
  lastName: string;
  mrn: string;
}): string {
  return foldForSearch(`${parts.firstName} ${parts.lastName} ${parts.mrn}`);
}
