/**
 * The interaction reference (spec M5: "with a reference database — the LLM is
 * not a source on its own").
 *
 * The AI layer is deliberately not involved in this file or anywhere near it. A
 * model asked whether two drugs interact will answer confidently either way,
 * and a confident wrong answer about a drug interaction is the worst output
 * this system could produce. Interactions come from a table a person can read.
 *
 * > **This is a starter set and no pharmacist has reviewed it.** It exists so
 * > the mechanism around it — name normalisation, pair matching, how a warning
 * > is surfaced and what silence means — is real, testable and ready for a
 * > proper source. The clinic must replace it. Until then, a clinician must
 * > read the "not recognised" list on every check, because **the absence of a
 * > warning here is not evidence of safety**.
 *
 * Moving this to a database table is the obvious next step and deliberately not
 * taken yet: there is no real data to put in one, and a CRUD screen over an
 * empty table is a worse lie than a file with a warning at the top of it.
 */

export type Severity = 'CONTRAINDICATED' | 'MAJOR' | 'MODERATE' | 'MINOR';

export interface Ingredient {
  /** Stable code used by the pair table and by the clients. */
  code: string;
  /**
   * Every spelling this system should recognise: generic, Turkish, English and
   * the brand names a patient is likely to type.
   *
   * Brands are here because a patient adding their own medication writes
   * "Augmentin", not "amoxicillin/clavulanic acid" — and a checker that only
   * knows generics silently recognises nothing a patient enters.
   */
  names: string[];
}

export const INGREDIENTS: Ingredient[] = [
  { code: 'warfarin', names: ['warfarin', 'varfarin', 'coumadin', 'kumadin', 'orfarin'] },
  { code: 'acetylsalicylic-acid', names: ['aspirin', 'asetilsalisilik asit', 'acetylsalicylic acid', 'coraspin', 'ecopirin'] },
  { code: 'ibuprofen', names: ['ibuprofen', 'ibufen', 'brufen', 'advil', 'nurofen'] },
  { code: 'naproxen', names: ['naproksen', 'naproxen', 'apranax'] },
  { code: 'paracetamol', names: ['parasetamol', 'paracetamol', 'acetaminophen', 'parol', 'panadol', 'calpol'] },
  { code: 'amoxicillin', names: ['amoksisilin', 'amoxicillin', 'largopen'] },
  { code: 'amoxicillin-clavulanate', names: ['amoklavin', 'augmentin', 'amoksisilin klavulanat', 'amoxicillin clavulanate'] },
  { code: 'clarithromycin', names: ['klaritromisin', 'clarithromycin', 'klacid', 'macrol'] },
  { code: 'ciprofloxacin', names: ['siprofloksasin', 'ciprofloxacin', 'cipro'] },
  { code: 'metronidazole', names: ['metronidazol', 'metronidazole', 'flagyl'] },
  { code: 'omeprazole', names: ['omeprazol', 'omeprazole', 'losec'] },
  { code: 'clopidogrel', names: ['klopidogrel', 'clopidogrel', 'plavix'] },
  { code: 'enoxaparin', names: ['enoksaparin', 'enoxaparin', 'clexane'] },
  { code: 'tramadol', names: ['tramadol', 'contramal'] },
  { code: 'codeine', names: ['kodein', 'codeine'] },
  { code: 'sertraline', names: ['sertralin', 'sertraline', 'lustral'] },
  { code: 'metformin', names: ['metformin', 'glucophage', 'glifor'] },
  { code: 'levothyroxine', names: ['levotiroksin', 'levothyroxine', 'euthyrox', 'tefor'] },
  { code: 'oral-contraceptive', names: ['doğum kontrol hapı', 'oral kontraseptif', 'oral contraceptive', 'yasmin', 'diane'] },
  { code: 'simvastatin', names: ['simvastatin', 'zocor'] },
];

export interface InteractionRule {
  /** Ingredient codes, in any order — matching is symmetric. */
  pair: [string, string];
  severity: Severity;
  /** What a clinician needs to know, in one sentence. */
  note: string;
}

/**
 * Pairs, not triples. Combination effects exist and are beyond a starter table;
 * saying so plainly is better than implying the table is complete.
 */
export const INTERACTIONS: InteractionRule[] = [
  {
    pair: ['warfarin', 'acetylsalicylic-acid'],
    severity: 'MAJOR',
    note: 'Kanama riski belirgin artar; birlikte kullanım yakın INR takibi gerektirir.',
  },
  {
    pair: ['warfarin', 'ibuprofen'],
    severity: 'MAJOR',
    note: 'NSAİİ ile birlikte kanama ve gastrointestinal ülser riski artar.',
  },
  {
    pair: ['warfarin', 'naproxen'],
    severity: 'MAJOR',
    note: 'NSAİİ ile birlikte kanama riski artar.',
  },
  {
    pair: ['warfarin', 'clarithromycin'],
    severity: 'MAJOR',
    note: 'Klaritromisin varfarin etkisini artırır; INR yükselebilir.',
  },
  {
    pair: ['warfarin', 'metronidazole'],
    severity: 'MAJOR',
    note: 'Metronidazol varfarin etkisini belirgin artırır.',
  },
  {
    pair: ['warfarin', 'ciprofloxacin'],
    severity: 'MODERATE',
    note: 'Siprofloksasin varfarin etkisini artırabilir; INR izlenmeli.',
  },
  {
    pair: ['clopidogrel', 'omeprazole'],
    severity: 'MODERATE',
    note: 'Omeprazol klopidogrelin etkinliğini azaltabilir.',
  },
  {
    pair: ['clopidogrel', 'acetylsalicylic-acid'],
    severity: 'MODERATE',
    note: 'İkili antiagregan tedavi kanama riskini artırır; bilinçli verilmiş olabilir.',
  },
  {
    pair: ['enoxaparin', 'acetylsalicylic-acid'],
    severity: 'MAJOR',
    note: 'Antikoagülan ve antiagregan birlikte kanama riskini belirgin artırır.',
  },
  {
    pair: ['enoxaparin', 'ibuprofen'],
    severity: 'MAJOR',
    note: 'NSAİİ ile birlikte kanama riski artar.',
  },
  {
    pair: ['ibuprofen', 'naproxen'],
    severity: 'MODERATE',
    note: 'İki NSAİİ birlikte; yarar artmaz, gastrointestinal risk artar.',
  },
  {
    pair: ['ibuprofen', 'acetylsalicylic-acid'],
    severity: 'MODERATE',
    note: 'İbuprofen aspirinin antiagregan etkisini azaltabilir.',
  },
  {
    pair: ['clarithromycin', 'simvastatin'],
    severity: 'CONTRAINDICATED',
    note: 'Rabdomiyoliz riski; birlikte kullanılmamalıdır.',
  },
  {
    pair: ['tramadol', 'sertraline'],
    severity: 'MAJOR',
    note: 'Serotonin sendromu riski.',
  },
  {
    pair: ['tramadol', 'codeine'],
    severity: 'MODERATE',
    note: 'İki opioid birlikte; solunum depresyonu riski artar.',
  },
  {
    pair: ['clarithromycin', 'oral-contraceptive'],
    severity: 'MINOR',
    note: 'Oral kontraseptif etkinliği azalabilir; ek korunma önerilir.',
  },
  {
    pair: ['amoxicillin', 'oral-contraceptive'],
    severity: 'MINOR',
    note: 'Oral kontraseptif etkinliği azalabilir; ek korunma önerilir.',
  },
  {
    pair: ['levothyroxine', 'omeprazole'],
    severity: 'MINOR',
    note: 'Mide asidi azalınca levotiroksin emilimi düşebilir.',
  },
];
