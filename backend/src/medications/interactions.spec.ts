import { INGREDIENTS, INTERACTIONS } from './interaction-reference';
import { check, duplicates, foldName, identify, isSevere } from './interactions';

const drug = (drugName: string, id = drugName): { id: string; drugName: string } => ({
  id,
  drugName,
});

/**
 * Drug interaction checking (spec M5, M9, T6.2).
 *
 * Two things decide whether this is useful, and only one of them is the table.
 * The first is whether it recognises the name a clinician actually wrote. The
 * second is whether a clinician can tell "nothing found" from "nothing
 * checked" — because reading the first as the second is how software misleads
 * somebody into thinking a combination is safe.
 */
describe('recognising what was written', () => {
  it('recognises the generic name in either language', () => {
    expect(identify('ibuprofen')).toBe('ibuprofen');
    expect(identify('Naproksen')).toBe('naproxen');
    expect(identify('naproxen')).toBe('naproxen');
  });

  /**
   * A patient adding their own medication writes the brand. A checker that only
   * knows generics silently recognises nothing they enter.
   */
  it('recognises the brand names a patient would type', () => {
    expect(identify('Augmentin')).toBe('amoxicillin-clavulanate');
    expect(identify('Coumadin')).toBe('warfarin');
    expect(identify('Parol')).toBe('paracetamol');
  });

  it('is not fooled by Turkish casing', () => {
    expect(identify('İBUPROFEN')).toBe('ibuprofen');
    expect(identify('Sİprofloksasin')).toBe('ciprofloxacin');
  });

  it('is not fooled by a missing Turkish keyboard', () => {
    expect(identify('siprofloksasin')).toBe(identify('siprofloksasin'));
    expect(identify('klaritromisin')).toBe('clarithromycin');
  });

  /** Strengths and forms are how a prescription is written, not what it is. */
  it('ignores the dose and the form', () => {
    expect(identify('Amoklavin BID 1000 mg film tablet')).toBe('amoxicillin-clavulanate');
    expect(identify('İbuprofen 400mg')).toBe('ibuprofen');
    expect(identify('Parol 500 mg tb')).toBe('paracetamol');
  });

  /**
   * Co-amoxiclav is not amoxicillin: different product, different interaction
   * profile. Matching the shorter name first would file every one of them under
   * plain amoxicillin.
   */
  it('does not collapse a combination product into its shorter component', () => {
    expect(identify('amoksisilin klavulanat')).toBe('amoxicillin-clavulanate');
    expect(identify('amoksisilin')).toBe('amoxicillin');
  });

  /**
   * The case a mutation test found: the exact-match pass hid the ordering. A
   * name written with anything around it goes through the substring pass, and
   * there the longer ingredient has to win — otherwise every co-amoxiclav
   * written as part of a sentence is filed under plain amoxicillin, which has a
   * different interaction profile.
   */
  it('prefers the longer ingredient when the name is written inside a phrase', () => {
    expect(identify('İlaç: amoksisilin klavulanat')).toBe('amoxicillin-clavulanate');
    expect(identify('oral amoksisilin klavulanat başlandı')).toBe('amoxicillin-clavulanate');
    expect(identify('oral amoksisilin başlandı')).toBe('amoxicillin');
  });

  it('says it does not know rather than guessing', () => {
    expect(identify('Bilinmeyen İlaç 50mg')).toBeNull();
    expect(identify('')).toBeNull();
    expect(identify('500 mg')).toBeNull();
  });

  it('folds a name the same way every time', () => {
    expect(foldName('İbuprofen')).toBe('ibuprofen');
    expect(foldName('Şurup')).toBe('surup');
  });
});

describe('checking a list', () => {
  it('finds a known interaction whichever order the drugs are in', () => {
    const forwards = check([drug('Coumadin'), drug('Aspirin')]);
    const backwards = check([drug('Aspirin'), drug('Coumadin')]);

    expect(forwards.warnings).toHaveLength(1);
    expect(forwards.warnings[0]!.severity).toBe('MAJOR');
    expect(backwards.warnings).toHaveLength(1);
  });

  it('carries the drugs as the clinician wrote them', () => {
    const result = check([drug('Coumadin 5mg', 'm1'), drug('Coraspin 100mg', 'm2')]);

    expect(result.warnings[0]!.between.map((d) => d.id)).toEqual(['m1', 'm2']);
    expect(result.warnings[0]!.between[0].drugName).toBe('Coumadin 5mg');
  });

  it('puts the most serious first', () => {
    const result = check([
      drug('Levotiroksin'),
      drug('Omeprazol'),
      drug('Klaritromisin'),
      drug('Simvastatin'),
    ]);

    expect(result.warnings[0]!.severity).toBe('CONTRAINDICATED');
    const severities = result.warnings.map((w) => w.severity);
    expect(severities).toEqual([...severities].sort());
  });

  it('checks every pair in a longer list', () => {
    const result = check([drug('a-unknown'), drug('Coumadin'), drug('Aspirin'), drug('İbuprofen')]);

    // Three recognised drugs is three pairs.
    expect(result.comparedPairs).toBe(3);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * The field that stops "no interactions" being read as "safe". A clinician
   * looking at an empty warning list needs to see that three of four drugs were
   * never checked.
   */
  it('names every drug it could not recognise', () => {
    const result = check([drug('Bilinmeyen A'), drug('Bilinmeyen B'), drug('Aspirin')]);

    expect(result.warnings).toEqual([]);
    expect(result.unrecognised.map((d) => d.drugName)).toEqual(['Bilinmeyen A', 'Bilinmeyen B']);
    // Nothing was compared, and the answer says so rather than looking clean.
    expect(result.comparedPairs).toBe(0);
  });

  it('compares nothing when only one drug is recognised', () => {
    expect(check([drug('Aspirin'), drug('Bilinmeyen')]).comparedPairs).toBe(0);
  });

  it('is quiet about a pair that has no rule', () => {
    const result = check([drug('Parol'), drug('Metformin')]);

    expect(result.warnings).toEqual([]);
    expect(result.comparedPairs).toBe(1);
    expect(result.unrecognised).toEqual([]);
  });

  it('handles an empty list without inventing anything', () => {
    expect(check([])).toEqual({ warnings: [], unrecognised: [], comparedPairs: 0 });
  });

  /**
   * Interrupting on a minor interaction is how a clinic learns to dismiss the
   * dialog without reading it.
   */
  it('separates what must interrupt from what is merely shown', () => {
    const severe = check([drug('Klaritromisin'), drug('Simvastatin')]).warnings[0]!;
    const minor = check([drug('Levotiroksin'), drug('Omeprazol')]).warnings[0]!;

    expect(isSevere(severe)).toBe(true);
    expect(isSevere(minor)).toBe(false);
  });
});

/** The same ingredient twice is a different kind of finding, and worth seeing. */
describe('the same drug under two names', () => {
  it('spots a brand and its generic prescribed together', () => {
    const groups = duplicates([drug('Coumadin', 'm1'), drug('Varfarin', 'm2'), drug('Parol', 'm3')]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((d) => d.id).sort()).toEqual(['m1', 'm2']);
  });

  it('does not report a single medication as a duplicate', () => {
    expect(duplicates([drug('Coumadin')])).toEqual([]);
  });

  it('does not report an interaction between a drug and itself', () => {
    expect(check([drug('Coumadin', 'm1'), drug('Varfarin', 'm2')]).warnings).toEqual([]);
  });
});

/**
 * The table is clinical content nobody has reviewed. These check its shape, not
 * its correctness — a test cannot tell whether an interaction is real.
 */
describe('the reference table itself', () => {
  const codes = new Set(INGREDIENTS.map((ingredient) => ingredient.code));

  it('has a code for every ingredient a rule refers to', () => {
    for (const rule of INTERACTIONS) {
      expect(codes.has(rule.pair[0])).toBe(true);
      expect(codes.has(rule.pair[1])).toBe(true);
    }
  });

  it('has no rule pairing an ingredient with itself', () => {
    for (const rule of INTERACTIONS) {
      expect(rule.pair[0]).not.toBe(rule.pair[1]);
    }
  });

  it('has no pair listed twice, in either order', () => {
    const seen = new Set<string>();

    for (const rule of INTERACTIONS) {
      const key = [...rule.pair].sort().join('|');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('gives every rule a sentence a clinician can act on', () => {
    for (const rule of INTERACTIONS) {
      expect(rule.note.length).toBeGreaterThan(20);
    }
  });

  it('has no ingredient whose names collide with another\'s', () => {
    const byName = new Map<string, string>();

    for (const ingredient of INGREDIENTS) {
      for (const name of ingredient.names) {
        const folded = foldName(name);
        const existing = byName.get(folded);

        expect(existing ?? ingredient.code).toBe(ingredient.code);
        byName.set(folded, ingredient.code);
      }
    }
  });

  it('recognises every name it lists', () => {
    for (const ingredient of INGREDIENTS) {
      for (const name of ingredient.names) {
        expect(identify(name)).toBe(ingredient.code);
      }
    }
  });
});
