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
  { code: 'atorvastatin', names: ['atorvastatin', 'atorvastatin kalsiyum', 'lipitor', 'ator'] },

  // --- Added for the operations this clinic actually does -----------------
  //
  // Aesthetic and bariatric surgery, and the medicines a health tourism
  // patient arrives already taking. Still a starter set; still unreviewed.

  // Anticoagulants beyond warfarin: a patient on a DOAC is common and the
  // bleeding interactions are the ones that matter around an operation.
  { code: 'rivaroxaban', names: ['rivaroksaban', 'rivaroxaban', 'xarelto'] },
  { code: 'apixaban', names: ['apiksaban', 'apixaban', 'eliquis'] },
  { code: 'dabigatran', names: ['dabigatran', 'pradaxa'] },

  // Analgesia after surgery.
  { code: 'diclofenac', names: ['diklofenak', 'diclofenac', 'voltaren', 'dolorex', 'cataflam'] },
  { code: 'metamizole', names: ['metamizol', 'dipiron', 'novalgin', 'noval', 'metamizole'] },
  { code: 'morphine', names: ['morfin', 'morphine'] },
  { code: 'pethidine', names: ['petidin', 'pethidine', 'aldolan', 'meperidine'] },

  // Antibiotics and antifungals used peri-operatively.
  { code: 'cefazolin', names: ['sefazolin', 'cefazolin', 'cezol', 'iespor'] },
  { code: 'levofloxacin', names: ['levofloksasin', 'levofloxacin', 'tavanic'] },
  { code: 'fluconazole', names: ['flukonazol', 'fluconazole', 'diflucan', 'flucan'] },
  { code: 'linezolid', names: ['linezolid', 'zyvoxid'] },

  // Reflux and nausea: routine after bariatric surgery.
  { code: 'pantoprazole', names: ['pantoprazol', 'pantoprazole', 'pantpas', 'controloc'] },
  { code: 'ondansetron', names: ['ondansetron', 'zofer', 'zofran'] },
  { code: 'metoclopramide', names: ['metoklopramid', 'metoclopramide', 'metpamid'] },
  { code: 'domperidone', names: ['domperidon', 'domperidone', 'motilium'] },

  // What a patient arrives on.
  { code: 'escitalopram', names: ['essitalopram', 'escitalopram', 'cipralex'] },
  { code: 'fluoxetine', names: ['fluoksetin', 'fluoxetine', 'prozac'] },
  { code: 'venlafaxine', names: ['venlafaksin', 'venlafaxine', 'efexor'] },
  { code: 'lithium', names: ['lityum', 'lithium', 'lithuril'] },
  { code: 'amiodarone', names: ['amiodaron', 'amiodarone', 'cordarone'] },
  { code: 'digoxin', names: ['digoksin', 'digoxin', 'lanoxin'] },
  { code: 'spironolactone', names: ['spironolakton', 'spironolactone', 'aldactone'] },
  { code: 'lisinopril', names: ['lisinopril', 'zestril'] },
  { code: 'losartan', names: ['losartan', 'cozaar'] },
  { code: 'prednisolone', names: ['prednizolon', 'prednisolone', 'metilprednizolon', 'prednol'] },
  { code: 'tamoxifen', names: ['tamoksifen', 'tamoxifen', 'nolvadex'] },
  { code: 'isotretinoin', names: ['izotretinoin', 'isotretinoin', 'roaccutane', 'aknetrent'] },
  { code: 'sumatriptan', names: ['sumatriptan', 'imigran'] },
  { code: 'st-johns-wort', names: ['sarı kantaron', "st john's wort", 'st johns wort', 'hypericum'] },
  { code: 'ginkgo', names: ['ginkgo', 'ginkgo biloba', 'gingko'] },
  { code: 'semaglutide', names: ['semaglutid', 'semaglutide', 'ozempic', 'wegovy'] },
  { code: 'insulin', names: ['insülin', 'insulin', 'lantus', 'novorapid', 'humalog'] },
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

  // --- Added with the ingredients above ------------------------------------
  //
  // Well-established pairs relevant to the operations this clinic does and to
  // what a health tourism patient arrives already taking. Still a starter set,
  // and still unreviewed by a pharmacist: see the header.
  {
    pair: ['rivaroxaban', 'acetylsalicylic-acid'],
    severity: 'MAJOR',
    note: 'Antikoagülan ve antiagregan birlikte kanama riskini belirgin artırır.',
  },
  {
    pair: ['rivaroxaban', 'ibuprofen'],
    severity: 'MAJOR',
    note: 'NSAİİ ile birlikte kanama riski artar.',
  },
  {
    pair: ['rivaroxaban', 'diclofenac'],
    severity: 'MAJOR',
    note: 'NSAİİ ile birlikte kanama riski artar.',
  },
  {
    pair: ['rivaroxaban', 'clarithromycin'],
    severity: 'MAJOR',
    note: 'Klaritromisin rivaroksaban düzeyini yükseltir; kanama riski artar.',
  },
  {
    pair: ['rivaroxaban', 'fluconazole'],
    severity: 'MAJOR',
    note: 'Flukonazol rivaroksaban düzeyini yükseltebilir.',
  },
  {
    pair: ['rivaroxaban', 'enoxaparin'],
    severity: 'MAJOR',
    note: 'İki antikoagülan birlikte; planlı geçiş dışında kullanılmamalıdır.',
  },
  {
    pair: ['warfarin', 'rivaroxaban'],
    severity: 'MAJOR',
    note: 'İki antikoagülan birlikte; yalnız planlı geçişte ve yakın takiple.',
  },
  {
    pair: ['apixaban', 'acetylsalicylic-acid'],
    severity: 'MAJOR',
    note: 'Antikoagülan ve antiagregan birlikte kanama riskini belirgin artırır.',
  },
  {
    pair: ['apixaban', 'ibuprofen'],
    severity: 'MAJOR',
    note: 'NSAİİ ile birlikte kanama riski artar.',
  },
  {
    pair: ['apixaban', 'clarithromycin'],
    severity: 'MAJOR',
    note: 'Klaritromisin apiksaban düzeyini yükseltir; kanama riski artar.',
  },
  {
    pair: ['dabigatran', 'acetylsalicylic-acid'],
    severity: 'MAJOR',
    note: 'Antikoagülan ve antiagregan birlikte kanama riskini belirgin artırır.',
  },
  {
    pair: ['dabigatran', 'ibuprofen'],
    severity: 'MAJOR',
    note: 'NSAİİ ile birlikte kanama riski artar.',
  },
  {
    pair: ['dabigatran', 'clopidogrel'],
    severity: 'MAJOR',
    note: 'İkili kanama riski; birlikte kullanım bilinçli bir karar olmalı.',
  },
  {
    pair: ['warfarin', 'diclofenac'],
    severity: 'MAJOR',
    note: 'NSAİİ ile birlikte kanama ve gastrointestinal ülser riski artar.',
  },
  {
    pair: ['diclofenac', 'ibuprofen'],
    severity: 'MODERATE',
    note: 'İki NSAİİ birlikte; yarar artmaz, gastrointestinal risk artar.',
  },
  {
    pair: ['diclofenac', 'naproxen'],
    severity: 'MODERATE',
    note: 'İki NSAİİ birlikte; yarar artmaz, gastrointestinal risk artar.',
  },
  {
    pair: ['diclofenac', 'prednisolone'],
    severity: 'MODERATE',
    note: 'NSAİİ ve kortikosteroid birlikte ülser riskini belirgin artırır.',
  },
  {
    pair: ['ibuprofen', 'prednisolone'],
    severity: 'MODERATE',
    note: 'NSAİİ ve kortikosteroid birlikte ülser riskini belirgin artırır.',
  },
  {
    pair: ['diclofenac', 'lisinopril'],
    severity: 'MODERATE',
    note: 'NSAİİ, ACE inhibitörünün etkisini azaltır ve böbrek fonksiyonunu bozabilir.',
  },
  {
    pair: ['ibuprofen', 'lisinopril'],
    severity: 'MODERATE',
    note: 'NSAİİ, ACE inhibitörünün etkisini azaltır ve böbrek fonksiyonunu bozabilir.',
  },
  {
    pair: ['diclofenac', 'lithium'],
    severity: 'MAJOR',
    note: 'NSAİİ lityum düzeyini yükseltir; toksisite riski.',
  },
  {
    pair: ['lisinopril', 'spironolactone'],
    severity: 'MODERATE',
    note: 'Birlikte hiperkalemi riski; potasyum izlenmeli.',
  },
  {
    pair: ['losartan', 'spironolactone'],
    severity: 'MODERATE',
    note: 'Birlikte hiperkalemi riski; potasyum izlenmeli.',
  },
  {
    pair: ['tramadol', 'escitalopram'],
    severity: 'MAJOR',
    note: 'Serotonin sendromu riski.',
  },
  {
    pair: ['tramadol', 'fluoxetine'],
    severity: 'MAJOR',
    note: 'Serotonin sendromu riski; fluoksetin ayrıca tramadolün etkisini azaltabilir.',
  },
  {
    pair: ['tramadol', 'venlafaxine'],
    severity: 'MAJOR',
    note: 'Serotonin sendromu ve nöbet riski.',
  },
  {
    pair: ['ondansetron', 'tramadol'],
    severity: 'MODERATE',
    note: 'Serotonin sendromu riski; ondansetron tramadolün ağrı kesici etkisini de azaltabilir.',
  },
  {
    pair: ['sumatriptan', 'sertraline'],
    severity: 'MODERATE',
    note: 'Serotonin sendromu riski.',
  },
  {
    pair: ['sumatriptan', 'escitalopram'],
    severity: 'MODERATE',
    note: 'Serotonin sendromu riski.',
  },
  {
    pair: ['linezolid', 'sertraline'],
    severity: 'CONTRAINDICATED',
    note: 'Serotonin sendromu; birlikte kullanılmamalıdır.',
  },
  {
    pair: ['linezolid', 'escitalopram'],
    severity: 'CONTRAINDICATED',
    note: 'Serotonin sendromu; birlikte kullanılmamalıdır.',
  },
  {
    pair: ['linezolid', 'venlafaxine'],
    severity: 'CONTRAINDICATED',
    note: 'Serotonin sendromu; birlikte kullanılmamalıdır.',
  },
  {
    pair: ['sertraline', 'warfarin'],
    severity: 'MODERATE',
    note: 'SSRI trombosit fonksiyonunu bozar; kanama riski artar.',
  },
  {
    pair: ['escitalopram', 'warfarin'],
    severity: 'MODERATE',
    note: 'SSRI trombosit fonksiyonunu bozar; kanama riski artar.',
  },
  {
    pair: ['sertraline', 'ibuprofen'],
    severity: 'MODERATE',
    note: 'SSRI ile NSAİİ birlikte gastrointestinal kanama riskini artırır.',
  },
  {
    pair: ['escitalopram', 'diclofenac'],
    severity: 'MODERATE',
    note: 'SSRI ile NSAİİ birlikte gastrointestinal kanama riskini artırır.',
  },
  {
    pair: ['amiodarone', 'clarithromycin'],
    severity: 'MAJOR',
    note: 'QT uzaması ve aritmi riski.',
  },
  {
    pair: ['amiodarone', 'levofloxacin'],
    severity: 'MAJOR',
    note: 'QT uzaması ve aritmi riski.',
  },
  {
    pair: ['amiodarone', 'ondansetron'],
    severity: 'MODERATE',
    note: 'QT uzaması riski artar.',
  },
  {
    pair: ['escitalopram', 'levofloxacin'],
    severity: 'MODERATE',
    note: 'QT uzaması riski artar.',
  },
  {
    pair: ['amiodarone', 'digoxin'],
    severity: 'MAJOR',
    note: 'Amiodaron digoksin düzeyini yükseltir; doz azaltılmalı.',
  },
  {
    pair: ['amiodarone', 'simvastatin'],
    severity: 'MAJOR',
    note: 'Rabdomiyoliz riski; simvastatin dozu sınırlandırılmalı.',
  },
  {
    pair: ['digoxin', 'spironolactone'],
    severity: 'MODERATE',
    note: 'Spironolakton digoksin düzeyini yükseltebilir.',
  },
  {
    pair: ['clarithromycin', 'atorvastatin'],
    severity: 'MAJOR',
    note: 'Rabdomiyoliz riski; statin geçici olarak kesilmeli.',
  },
  {
    pair: ['fluconazole', 'simvastatin'],
    severity: 'MAJOR',
    note: 'Kas hasarı (rabdomiyoliz) riski; kas ağrısı ve CK izlenmeli.',
  },
  {
    pair: ['fluconazole', 'atorvastatin'],
    severity: 'MODERATE',
    note: 'Statin düzeyi yükselir; kas ağrısı izlenmeli.',
  },
  {
    pair: ['fluconazole', 'warfarin'],
    severity: 'MAJOR',
    note: 'Flukonazol varfarin etkisini belirgin artırır; INR yükselir.',
  },
  {
    pair: ['fluconazole', 'oral-contraceptive'],
    severity: 'MINOR',
    note: 'Etkinlik değişebilir; ek korunma önerilir.',
  },
  {
    pair: ['st-johns-wort', 'oral-contraceptive'],
    severity: 'MAJOR',
    note: 'Sarı kantaron doğum kontrol hapının etkinliğini belirgin azaltır.',
  },
  {
    pair: ['st-johns-wort', 'warfarin'],
    severity: 'MAJOR',
    note: 'Sarı kantaron varfarin etkisini azaltır; INR düşer.',
  },
  {
    pair: ['st-johns-wort', 'sertraline'],
    severity: 'MAJOR',
    note: 'Serotonin sendromu riski.',
  },
  {
    pair: ['st-johns-wort', 'escitalopram'],
    severity: 'MAJOR',
    note: 'Serotonin sendromu riski.',
  },
  {
    pair: ['ginkgo', 'warfarin'],
    severity: 'MODERATE',
    note: 'Ginkgo kanama riskini artırabilir.',
  },
  {
    pair: ['ginkgo', 'acetylsalicylic-acid'],
    severity: 'MODERATE',
    note: 'Ginkgo kanama riskini artırabilir.',
  },
  {
    pair: ['levothyroxine', 'pantoprazole'],
    severity: 'MINOR',
    note: 'Mide asidi azalınca levotiroksin emilimi düşebilir.',
  },
  {
    pair: ['clopidogrel', 'pantoprazole'],
    severity: 'MINOR',
    note: 'Omeprazole göre etkileşimi zayıftır; pantoprazol tercih edilir.',
  },
  {
    pair: ['semaglutide', 'insulin'],
    severity: 'MAJOR',
    note: 'Birlikte hipoglisemi riski belirgin artar; insülin dozu azaltılmalı.',
  },
  {
    pair: ['semaglutide', 'metformin'],
    severity: 'MINOR',
    note: 'Birlikte kullanılabilir; gastrointestinal yan etkiler artabilir.',
  },
  {
    pair: ['semaglutide', 'metoclopramide'],
    severity: 'MODERATE',
    note: 'İkisi de mide boşalmasını etkiler; bulantı ve kusma artabilir.',
  },
  {
    pair: ['metoclopramide', 'domperidone'],
    severity: 'MODERATE',
    note: 'İki prokinetik birlikte; yarar artmaz, yan etki riski artar.',
  },
  {
    pair: ['metoclopramide', 'sertraline'],
    severity: 'MODERATE',
    note: 'Ekstrapiramidal yan etki ve serotonin sendromu riski.',
  },
  {
    pair: ['morphine', 'tramadol'],
    severity: 'MODERATE',
    note: 'İki opioid birlikte; solunum depresyonu riski artar.',
  },
  {
    pair: ['pethidine', 'tramadol'],
    severity: 'MAJOR',
    note: 'Nöbet ve serotonin sendromu riski.',
  },
  {
    pair: ['pethidine', 'sertraline'],
    severity: 'MAJOR',
    note: 'Serotonin sendromu riski.',
  },
  {
    pair: ['morphine', 'codeine'],
    severity: 'MODERATE',
    note: 'İki opioid birlikte; solunum depresyonu riski artar.',
  },
  {
    pair: ['metamizole', 'warfarin'],
    severity: 'MODERATE',
    note: 'Metamizol varfarin etkisini artırabilir; INR izlenmeli.',
  },
  {
    pair: ['tamoxifen', 'fluoxetine'],
    severity: 'MAJOR',
    note: 'Fluoksetin tamoksifenin etkin metabolitini azaltır.',
  },
  {
    pair: ['tamoxifen', 'warfarin'],
    severity: 'MAJOR',
    note: 'Tamoksifen varfarin etkisini artırır; kanama riski.',
  },
  {
    pair: ['isotretinoin', 'metamizole'],
    severity: 'MINOR',
    note: 'Karaciğer enzimleri izlenmeli.',
  },
];
