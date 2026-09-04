/**
 * Which number a patient should dial where they actually are (spec M8).
 *
 * Health tourism makes this a real question rather than a constant: the clinic
 * is in Turkey, the patient pressing the button three weeks after surgery is
 * usually at home in Germany, Iraq or the UK. A card that says 112 to someone
 * in Chicago is a card that wastes the minute it was meant to save.
 *
 * Two things about this table are worth stating plainly rather than burying:
 *
 *   - **It keys off the country on the patient's file**, not off their GPS fix.
 *     Reverse geocoding would need an outside service on the one request that
 *     must never depend on one. The consequence is that a patient travelling
 *     gets their home country's number, so the client shows the country name
 *     next to the number — a Turk holidaying in Spain can see it says Türkiye
 *     and dial 112 anyway.
 *   - **It is operational data, not engineering data.** Numbers change, and
 *     several countries route medical calls differently from police. It lives
 *     in one file, with one shape, so a clinic can review it as a list. It has
 *     not been verified against an authoritative source here.
 */

export interface EmergencyNumber {
  /** What to dial. */
  number: string;
  /** ISO 3166-1 alpha-2 the answer was chosen for, uppercase. */
  countryCode: string;
  /**
   * `country` when the table had an entry, `international` when it fell back.
   * The clients say different things for the two: a fallback number needs the
   * caveat, a known one does not.
   */
  source: 'country' | 'international';
  /**
   * 112, when the country's own number is something else.
   *
   * Not redundancy for its own sake. Compiling this table turned up rows where
   * published sources disagree about which number reaches an ambulance —
   * Morocco is one, where reputable sources give both 15 and 150. Resolving
   * that from here would be guessing, and a guessed emergency number is the
   * exact failure this table can have.
   *
   * 112 is the answer that does not depend on winning that argument: it works
   * from any GSM handset almost everywhere and routes to the local service. So
   * the card offers both, and a patient who reaches the wrong desk has a second
   * number in front of them rather than a search to run one-handed.
   */
  alsoTry: string | null;
}

/**
 * 112 reaches emergency services across the EU and EEA, and GSM handsets route
 * it to the local service in most of the rest of the world.
 */
const INTERNATIONAL = '112';

/**
 * Medical/ambulance numbers where a country separates them from police, and the
 * general emergency number otherwise.
 */
const NUMBERS: Record<string, string> = {
  // Europe: 112 is the single European emergency number.
  AT: '112', BE: '112', BG: '112', CH: '112', CY: '112', CZ: '112',
  DE: '112', DK: '112', EE: '112', ES: '112', FI: '112', FR: '112',
  GR: '112', HR: '112', HU: '112', IE: '112', IS: '112', IT: '112',
  LT: '112', LU: '112', LV: '112', MT: '112', NL: '112', NO: '112',
  PL: '112', PT: '112', RO: '112', RS: '112', SE: '112', SI: '112',
  SK: '112', TR: '112', AL: '112', MD: '112', ME: '112', MK: '112',
  BA: '112', XK: '112',

  // The UK answers 999; 112 also works, but 999 is the number people know.
  GB: '999',

  US: '911', CA: '911', MX: '911',

  AU: '000', NZ: '111',

  // Ambulance services dialled separately from police.
  RU: '103', UA: '103', BY: '103', KZ: '103', AZ: '103', AM: '103',
  GE: '112', UZ: '103',

  IL: '101',
  AE: '998', SA: '997', QA: '999', KW: '112', BH: '998', OM: '9999',
  JO: '911', LB: '140', IQ: '122', IR: '115',

  EG: '123', MA: '150', DZ: '14', TN: '190', LY: '193',

  IN: '112', PK: '1122', BD: '999', CN: '120', JP: '119', KR: '119',
  TH: '1669', SG: '995', MY: '999', ID: '119', PH: '911', VN: '115',

  ZA: '10177', NG: '112', KE: '999', ET: '907',

  BR: '192', AR: '107', CL: '131', CO: '123', PE: '106',
};

/**
 * Never throws and never returns nothing.
 *
 * The caller is a patient who has already pressed the button; there is no
 * sensible failure mode here other than showing a number that will reach
 * somebody.
 */
export function emergencyNumberFor(country: string | null | undefined): EmergencyNumber {
  const code = (country ?? '').trim().toUpperCase();
  const known = NUMBERS[code];

  if (known && code.length === 2) {
    return {
      number: known,
      countryCode: code,
      source: 'country',
      alsoTry: known === INTERNATIONAL ? null : INTERNATIONAL,
    };
  }

  return {
    number: INTERNATIONAL,
    countryCode: code.length === 2 ? code : '',
    source: 'international',
    alsoTry: null,
  };
}

/** For the operational review this table needs: how many countries it covers. */
export function coveredCountries(): string[] {
  return Object.keys(NUMBERS).sort();
}
