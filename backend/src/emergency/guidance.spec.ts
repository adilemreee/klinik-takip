import { coveredCountries, emergencyNumberFor } from './emergency-numbers';
import { buildGuidance } from './guidance';

/**
 * The card a patient sees while they wait.
 *
 * Nothing here is clever. What it has to be is *present* — the failure mode is
 * a blank card, or a card whose one useful line is missing because a lookup
 * returned nothing.
 */
describe('the emergency number', () => {
  it('knows the country the clinic is in', () => {
    expect(emergencyNumberFor('TR')).toEqual({ number: '112', countryCode: 'TR', source: 'country', alsoTry: null });
  });

  it('answers 999 for the United Kingdom, which is the number people there know', () => {
    expect(emergencyNumberFor('GB').number).toBe('999');
  });

  it('answers 911 in North America', () => {
    expect(emergencyNumberFor('US').number).toBe('911');
  });

  it('accepts a lowercase code, because the column is free text', () => {
    expect(emergencyNumberFor('de')).toEqual({ number: '112', countryCode: 'DE', source: 'country', alsoTry: null });
  });

  /**
   * Never nothing. The caller is a patient who has already pressed the button;
   * a null here would render as an empty line on the one card that must not
   * have one.
   */
  it('falls back to the international number for anything it does not know', () => {
    for (const unknown of [null, undefined, '', 'ZZ', 'Turkey', '  ']) {
      const answer = emergencyNumberFor(unknown);

      expect(answer.number).toBe('112');
      expect(answer.source).toBe('international');
    }
  });

  it('says which answers were guessed, so the client can add the caveat', () => {
    expect(emergencyNumberFor('TR').source).toBe('country');
    expect(emergencyNumberFor('ZZ').source).toBe('international');
  });

  it('has no malformed entries', () => {
    for (const code of coveredCountries()) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(emergencyNumberFor(code).number).toMatch(/^[0-9]{2,5}$/);
    }
  });
});

describe('the guidance card', () => {
  it('puts the local number in the line that tells them to dial it', () => {
    const card = buildGuidance('GB', 'en');
    const critical = card.steps.find((step) => step.critical);

    expect(critical?.text).toContain('999');
    expect(card.steps.some((step) => step.text.includes('{number}'))).toBe(false);
  });

  /**
   * Exactly one, because the clients render it differently from the rest. Two
   * would make the emphasis meaningless; none would bury the only line that
   * matters in a list of housekeeping.
   */
  it('has exactly one line that points away from the clinic', () => {
    expect(buildGuidance('TR', 'tr').steps.filter((step) => step.critical)).toHaveLength(1);
  });

  it('is written in the patient\'s language when it has one', () => {
    expect(buildGuidance('DE', 'en').language).toBe('en');
    expect(buildGuidance('DE', 'tr').language).toBe('tr');
  });

  /**
   * Per card, not per line: half of a list in Turkish and half in Russian
   * reads as a broken app at the moment the patient most needs to trust it.
   */
  it('falls back to Turkish as a whole rather than line by line', () => {
    const card = buildGuidance('RU', 'ru');

    expect(card.language).toBe('tr');
    expect(card.steps.every((step) => step.text.length > 0)).toBe(true);
  });

  it('is never empty, whatever it is given', () => {
    for (const country of [null, 'ZZ', 'TR']) {
      for (const language of [null, 'xx', 'en']) {
        const card = buildGuidance(country, language);

        expect(card.steps.length).toBeGreaterThan(0);
        expect(card.emergencyNumber.number).not.toBe('');
      }
    }
  });
});

describe('the second number', () => {
  it('offers 112 alongside a country number that is not 112', () => {
    // Published sources disagree about which number reaches an ambulance in
    // some countries; 112 is the answer that does not depend on settling that.
    const uk = emergencyNumberFor('GB');

    expect(uk.number).toBe('999');
    expect(uk.alsoTry).toBe('112');
  });

  it('does not repeat 112 to itself', () => {
    // "Call 112, or try 112" reads as a broken screen at the worst moment.
    expect(emergencyNumberFor('DE').alsoTry).toBeNull();
  });

  it('offers nothing extra when 112 was already the fallback', () => {
    // An unknown country already gets 112 as the primary answer.
    const unknown = emergencyNumberFor('ZZ');

    expect(unknown.source).toBe('international');
    expect(unknown.alsoTry).toBeNull();
  });
});
