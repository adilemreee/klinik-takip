import { TranslationService } from './translation.service';

/**
 * Reading the model's answer.
 *
 * The failure that matters is the quiet one: handing back whatever came out
 * would put "Here is the translation:" or half a JSON object into a
 * clinician's message thread looking like something the patient wrote.
 */
describe('TranslationService.parse', () => {
  it('reads a clean answer', () => {
    expect(
      TranslationService.parse('{"language":"de","text":"Die Wunde ist rot."}'),
    ).toEqual({ language: 'de', text: 'Die Wunde ist rot.' });
  });

  /// Models prefix answers with prose however firmly the prompt says not to.
  it('finds the JSON inside surrounding chatter', () => {
    expect(
      TranslationService.parse('Here you go:\n{"language":"de","text":"Merhaba"}\nHope that helps'),
    ).toEqual({ language: 'de', text: 'Merhaba' });
  });

  it('accepts an answer with no language reported', () => {
    expect(TranslationService.parse('{"text":"Merhaba"}')).toEqual({
      language: null,
      text: 'Merhaba',
    });
  });

  it('refuses an answer that is not JSON at all', () => {
    expect(TranslationService.parse('Sorry, I cannot translate that.')).toBeNull();
  });

  it('refuses a truncated answer', () => {
    expect(TranslationService.parse('{"language":"de","text":"Die Wunde')).toBeNull();
  });

  /// An empty translation is not a translation, and showing one would read as
  /// a message the patient sent blank.
  it('refuses an empty translation', () => {
    expect(TranslationService.parse('{"language":"de","text":"   "}')).toBeNull();
    expect(TranslationService.parse('{"language":"de"}')).toBeNull();
  });

  it('refuses a translation that is not a string', () => {
    expect(TranslationService.parse('{"language":"de","text":42}')).toBeNull();
  });
});
