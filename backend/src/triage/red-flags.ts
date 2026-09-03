import { TriageLevel } from '@prisma/client';

/**
 * The pass that runs whether or not the AI does (spec M4, section 14.3).
 *
 * A keyword screen is crude, and that is the point. It is here because the
 * model can be switched off, unpaid for, rate-limited, timed out or simply
 * wrong, and a patient writing "nefes alamıyorum" at three in the morning must
 * not depend on any of that. Its errors run toward raising the level, which is
 * the only direction an error here is allowed to run: a nurse reading a message
 * that turned out to be nothing costs a minute, and the other mistake costs
 * something else entirely.
 *
 * > **This list is clinical content and has not been reviewed by a clinician.**
 * > It lives in one file, in one shape, so that a doctor can read it as a list
 * > and correct it. Treat it as a starting point that the clinic owns.
 *
 * > **Known gap: Turkish and English only.** The specification's initial
 * > language set also includes German, Russian and Arabic. A patient writing in
 * > those languages gets no keyword screen — they get the AI pass when it is
 * > enabled, and in every case they still get a human, because the floor below
 * > all of this is ROUTINE.
 */

export interface RedFlag {
  /** Stable id, so a match can be shown and audited without the phrase. */
  id: string;
  level: TriageLevel;
  /**
   * Folded, lowercase stems matched as substrings.
   *
   * Stems rather than whole words because Turkish glues its endings on:
   * "alamıyorum", "alamıyor" and "alamadım" are the same complaint, and a word
   * list would need all of them and still miss the fourth.
   */
  stems: string[];
}

export const RED_FLAGS: RedFlag[] = [
  // --- Airway, breathing, circulation -------------------------------------
  {
    id: 'breathing',
    level: TriageLevel.EMERGENCY,
    stems: [
      'nefes alam',
      'nefes almakta zorlan',
      'nefes darlig',
      'boguluyor',
      'soluk alam',
      'cannot breathe',
      "can't breathe",
      'trouble breathing',
      'short of breath',
      'shortness of breath',
    ],
  },
  {
    id: 'chest-pain',
    level: TriageLevel.EMERGENCY,
    stems: ['gogus agri', 'gogsum agri', 'gogsume bask', 'kalbim sikis', 'chest pain', 'chest tightness'],
  },
  {
    id: 'uncontrolled-bleeding',
    level: TriageLevel.EMERGENCY,
    stems: [
      'kanama durm',
      'kanamayi durdur',
      'kan fiskir',
      'cok kan kayb',
      'bleeding will not stop',
      "bleeding won't stop",
      'heavy bleeding',
    ],
  },
  {
    id: 'loss-of-consciousness',
    level: TriageLevel.EMERGENCY,
    stems: ['bayildim', 'bayilacak gibi', 'bilincini kayb', 'bilincim', 'kendimden gectim', 'fainted', 'passed out', 'blacked out'],
  },
  {
    id: 'seizure',
    level: TriageLevel.EMERGENCY,
    stems: ['nobet gecir', 'havale gecir', 'kasilma gecir', 'seizure', 'convulsion'],
  },
  {
    id: 'cyanosis',
    level: TriageLevel.EMERGENCY,
    stems: ['dudaklarim morar', 'parmaklarim morar', 'turning blue', 'lips are blue'],
  },
  {
    id: 'stroke-signs',
    level: TriageLevel.EMERGENCY,
    stems: ['konusamiyor', 'yuzum kay', 'agzim kay', 'felc', 'kolum tutmuyor', "can't speak", 'face is drooping', 'slurred speech'],
  },
  {
    id: 'self-harm',
    level: TriageLevel.EMERGENCY,
    stems: ['intihar', 'kendime zarar', 'yasamak istemiyorum', 'olmek istiyorum', 'suicide', 'kill myself', 'harm myself'],
  },

  // --- Post-operative complications ---------------------------------------
  {
    id: 'wound-infection',
    level: TriageLevel.URGENT,
    stems: ['yarada akinti', 'yaradan akinti', 'yara iltihap', 'kotu koku', 'yara kizar', 'iltihapl', 'wound discharge', 'pus', 'foul smell', 'wound is red'],
  },
  {
    id: 'wound-dehiscence',
    level: TriageLevel.URGENT,
    stems: ['dikis acil', 'dikisler acil', 'yara acil', 'yaram acil', 'stitches opened', 'wound opened'],
  },
  {
    id: 'fever',
    level: TriageLevel.URGENT,
    stems: ['atesim 38', 'atesim 39', 'atesim 40', 'yuksek ates', 'ates cikt', 'atesim var', 'high fever', 'temperature is 38', 'temperature is 39'],
  },
  {
    id: 'possible-clot',
    level: TriageLevel.URGENT,
    stems: ['bacagim sis', 'baldirimda agri', 'bacagimda agri', 'tek bacag', 'calf pain', 'leg is swollen', 'one leg swollen'],
  },
  {
    id: 'persistent-vomiting',
    level: TriageLevel.URGENT,
    stems: ['kusmam durm', 'surekli kusuyor', 'hicbir sey tutam', 'su bile icemi', 'cannot keep anything down', 'vomiting blood', 'kan kusu'],
  },
  {
    id: 'no-urine',
    level: TriageLevel.URGENT,
    stems: ['idrar yapam', 'idrarim gelm', 'cannot urinate', 'not passing urine'],
  },
  {
    id: 'severe-pain',
    level: TriageLevel.URGENT,
    stems: ['dayanilmaz agri', 'siddetli agri', 'agri gecmiyor', 'agri kesici ise yaram', 'unbearable pain', 'severe pain', 'painkillers are not working'],
  },
];

/** How a phrase is normalised before matching, on both sides. */
export function foldForMatch(value: string): string {
  return value
    .replace(/[İIıi]/g, 'i')
    .toLowerCase()
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    // A patient typing without Turkish characters writes "nefes alamiyorum";
    // one with a Turkish keyboard writes "alamıyorum". Both must match, so both
    // sides lose their diacritics.
    .replace(/\s+/g, ' ');
}

export interface Screening {
  level: TriageLevel;
  /** Ids of what matched, for the record. Never the patient's own words. */
  matched: string[];
}

/**
 * The floor this message sits on before anything else looks at it.
 *
 * ROUTINE, never INFO: the lowest this pass will place a message is "a human
 * reads it". Deciding that something needs no human is a decision this screen
 * is nowhere near good enough to make, and the AI is not allowed to make it
 * either — see `raiseTo`.
 */
export function screen(text: string): Screening {
  const folded = foldForMatch(text);
  const matched: string[] = [];
  let level: TriageLevel = TriageLevel.ROUTINE;

  for (const flag of RED_FLAGS) {
    if (!flag.stems.some((stem) => folded.includes(stem))) continue;

    matched.push(flag.id);

    if (flag.level === TriageLevel.EMERGENCY) {
      level = TriageLevel.EMERGENCY;
    } else if (level !== TriageLevel.EMERGENCY) {
      level = TriageLevel.URGENT;
    }
  }

  return { level, matched };
}
