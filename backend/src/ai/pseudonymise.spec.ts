import {
  ageFrom,
  findLeaks,
  looksLikeTurkishNationalId,
  pseudonymise,
  redact,
} from './pseudonymise';

const now = new Date('2026-03-04T12:00:00.000Z');

/**
 * What leaves the building.
 *
 * The failure this guards against leaves no trace on our side: the prompt goes
 * out with a name in it, the answer comes back, everything works, and the only
 * record of it is on somebody else's server.
 */
describe('the patient shape a prompt may carry', () => {
  it('carries an age and not a birth date', () => {
    const safe = pseudonymise(
      { birthDate: new Date('1985-06-12'), sex: 'FEMALE', country: 'DE', preferredLanguage: 'tr' },
      'hasta-1',
      now,
    );

    expect(safe).toEqual({
      ref: 'hasta-1',
      age: 40,
      sex: 'FEMALE',
      country: 'DE',
      preferredLanguage: 'tr',
    });
  });

  /** A name, a file number or a phone must have nowhere to sit. */
  it('has no field a name could be put in', () => {
    const safe = pseudonymise({ birthDate: null }, 'hasta-1', now);

    expect(Object.keys(safe).sort()).toEqual(['age', 'country', 'preferredLanguage', 'ref', 'sex']);
  });

  it('counts an age that has not had its birthday yet', () => {
    expect(ageFrom(new Date('1985-12-31'), now)).toBe(40);
    expect(ageFrom(new Date('1986-01-01'), now)).toBe(40);
    expect(ageFrom(new Date('1985-03-04'), now)).toBe(41);
  });

  it('refuses an impossible birth date rather than inventing an age', () => {
    expect(ageFrom(new Date('2030-01-01'), now)).toBeNull();
    expect(ageFrom(null)).toBeNull();
  });
});

describe('reading a finished prompt for identifiers', () => {
  const patient = {
    names: ['Ayşe', 'Yılmaz'],
    mrn: 'MRN-90210',
    phone: '+90 532 111 22 33',
    email: 'ayse@example.com',
  };

  it('passes a prompt that names nobody', () => {
    expect(
      findLeaks('45 yaşında kadın hasta, sleeve gastrektomi sonrası 9. gün, yarada kızarıklık.', patient),
    ).toEqual([]);
  });

  /**
   * The case the structured shape cannot see: prompts are built from free text
   * — the patient's own message, a clinician's note, an OCR'd report — and the
   * name is very often written inside it.
   */
  it('catches a name written into free text', () => {
    expect(findLeaks('Hasta Ayşe dün akşam ateşlendi.', patient)).toEqual([{ kind: 'name' }]);
  });

  /**
   * Turkish lowercasing maps I to ı and İ to i, so a name in capitals folds to
   * a different string than the same name in title case — and slips past a
   * check that only calls toLowerCase().
   */
  it('catches a name written in capitals', () => {
    expect(findLeaks('HASTA AYŞE YILMAZ', patient)).toEqual([{ kind: 'name' }]);
  });

  it('does not fire on a name that is only part of a longer word', () => {
    expect(findLeaks('Ayşegül adlı ilaç değil, ayşeler de yok.', { names: ['Ayşe'] })).toEqual([]);
  });

  it('ignores names too short to match anything but noise', () => {
    // "Su" would appear in half the Turkish sentences ever written, and a check
    // that refuses every prompt is a check somebody switches off.
    expect(findLeaks('Hastaya bol su içmesi söylendi.', { names: ['Su'] })).toEqual([]);
  });

  it('catches the file number', () => {
    expect(findLeaks('Dosya MRN-90210 hakkında', patient)).toEqual([{ kind: 'mrn' }]);
  });

  it('catches an e-mail address', () => {
    expect(findLeaks('İletişim: AYSE@example.com', patient)).toEqual([{ kind: 'email' }]);
  });

  /** The same number is written three ways by three different people. */
  it('catches a phone number however it is written', () => {
    for (const written of ['+90 532 111 22 33', '0532 111 22 33', '532-111-22-33', '05321112233']) {
      expect(findLeaks(`Telefon: ${written}`, patient)).toEqual([{ kind: 'phone' }]);
    }
  });

  it('does not read a lab value as a phone number', () => {
    expect(findLeaks('Hemoglobin 13.4 g/dL, trombosit 250000', patient)).toEqual([]);
  });

  /**
   * The identifier most likely to be typed into a free-text note, and the one
   * that can be recognised without knowing whose it is.
   */
  it('catches a national identity number by its checksum', () => {
    expect(findLeaks('TC 10000000146 numaralı hasta', {})).toEqual([{ kind: 'national-id' }]);
  });

  it('leaves an ordinary eleven-digit number alone', () => {
    expect(findLeaks('Referans 12345678901', {})).toEqual([]);
  });

  it('reports every leak at once, not the first', () => {
    const leaks = findLeaks('Ayşe Yılmaz, MRN-90210, ayse@example.com', patient);

    expect(leaks.map((leak) => leak.kind).sort()).toEqual(['email', 'mrn', 'name']);
  });

  /**
   * A refusal is logged, and a log line naming the identifier would be the leak
   * it just prevented — written somewhere it is kept for weeks.
   */
  it('never carries the value it found', () => {
    const leaks = findLeaks('Ayşe Yılmaz aradı', patient);

    expect(JSON.stringify(leaks)).not.toContain('Ay');
    expect(Object.keys(leaks[0]!)).toEqual(['kind']);
  });
});

describe('the national identity checksum', () => {
  it('accepts a valid number', () => {
    expect(looksLikeTurkishNationalId('10000000146')).toBe(true);
  });

  it('rejects one that fails either digit', () => {
    expect(looksLikeTurkishNationalId('10000000145')).toBe(false);
    expect(looksLikeTurkishNationalId('10000000246')).toBe(false);
  });

  it('rejects a leading zero and a wrong length', () => {
    expect(looksLikeTurkishNationalId('01000000146')).toBe(false);
    expect(looksLikeTurkishNationalId('1000000014')).toBe(false);
  });
});

/**
 * Taking the identifiers out instead of refusing the prompt.
 *
 * People sign their messages. Refusing every one that says "Ben Ayşe" would
 * leave exactly those messages untriaged, which is the opposite of safe.
 */
describe('scrubbing a prompt', () => {
  const patient = {
    names: ['Ayşe', 'Yılmaz'],
    mrn: 'MRN-90210',
    phone: '+90 532 111 22 33',
    email: 'ayse@example.com',
  };

  it('replaces a name with a placeholder a model can read', () => {
    const { text, redacted } = redact('Ben Ayşe, dün akşam ateşlendim.', patient);

    expect(text).toBe('Ben [ad], dün akşam ateşlendim.');
    expect(redacted).toEqual(['name']);
  });

  it('leaves a clean message untouched', () => {
    const message = '45 yaşında kadın, ameliyat sonrası 9. gün.';

    expect(redact(message, patient)).toEqual({ text: message, redacted: [] });
  });

  it('replaces every occurrence, not just the first', () => {
    const { text } = redact('Ayşe geldi. Ayşe gitti.', patient);

    expect(text).toBe('[ad] geldi. [ad] gitti.');
  });

  it('scrubs a phone number however it was written', () => {
    expect(redact('Beni 0532 111 22 33 numarasından arayın', patient).text).toBe(
      'Beni [telefon] numarasından arayın',
    );
  });

  it('scrubs a national identity number', () => {
    expect(redact('TC 10000000146', {}).text).toBe('TC [kimlik-no]');
  });

  /**
   * An e-mail address contains the name it was made from, so the two spans
   * overlap. Replacing both would cut the placeholder in half.
   */
  it('does not cut one placeholder in half with another', () => {
    const { text } = redact('Yazın: ayse@example.com', patient);

    expect(text).toBe('Yazın: [e-posta]');
  });

  it('scrubs a name written in capitals', () => {
    expect(redact('HASTA AYŞE YILMAZ ARADI', patient).text).toBe('HASTA [ad] [ad] ARADI');
  });

  /**
   * The point of the pair: the gate still refuses a prompt carrying
   * identifiers, so what the scrubber missed is what the check now catches.
   */
  it('leaves nothing for the leak check to find', () => {
    const messy = 'Ben Ayşe Yılmaz, dosyam MRN-90210, telefonum 0532 111 22 33, TC 10000000146.';

    expect(findLeaks(redact(messy, patient).text, patient)).toEqual([]);
  });

  it('keeps the surrounding text exactly as it was', () => {
    const { text } = redact('Ateşim 38.5, Ayşe.', patient);

    expect(text).toBe('Ateşim 38.5, [ad].');
  });
});
