import { ConsentsService } from './consents.service';

/**
 * Filling the form's own fields.
 *
 * A document that does not name the operation is not informed consent, so the
 * failure worth guarding is the quiet one: a patient reading `{{hekim}}` in a
 * consent form is reading a bug, and a form that silently dropped the field
 * would be worse still.
 */
describe('ConsentsService.fill', () => {
  it('puts the procedure in the form', () => {
    expect(
      ConsentsService.fill('Planlanan işlem: **{{islem}}**', { islem: 'Rinoplasti' }),
    ).toBe('Planlanan işlem: **Rinoplasti**');
  });

  it('fills every field it is given', () => {
    const filled = ConsentsService.fill('{{islem}} / {{hekim}} / {{tarih}}', {
      islem: 'Rinoplasti',
      hekim: 'Ayşe Yılmaz',
      tarih: '02 Kasım 2026',
    });

    expect(filled).toBe('Rinoplasti / Ayşe Yılmaz / 02 Kasım 2026');
  });

  /// A visible marker, never braces and never a silent deletion.
  it('marks a field it has no value for', () => {
    expect(ConsentsService.fill('Hekim: {{hekim}}', {})).toBe('Hekim: —');
    expect(ConsentsService.fill('Hekim: {{hekim}}', { hekim: '   ' })).toBe('Hekim: —');
  });

  it('leaves the rest of the document alone', () => {
    const source = '# Başlık\n\nBir { tek } süslü parantez ve {{islem}}.';

    expect(ConsentsService.fill(source, { islem: 'X' })).toBe(
      '# Başlık\n\nBir { tek } süslü parantez ve X.',
    );
  });
});

/**
 * What the patient is shown.
 *
 * The file also carries a note to whoever maintains it — that it wants a
 * lawyer's eye, which fields to fill. Serving that puts "this is a draft" at
 * the top of the document somebody is about to sign.
 */
describe('ConsentsService.forPatient', () => {
  it('drops the note written for the clinic', () => {
    const document = [
      '# Onam Formu',
      '',
      '> Bu metin avukat incelemesi gerektirir.',
      '',
      '<!-- ONAM-BASLANGIC -->',
      '',
      '## Kim, neyi onaylıyor',
    ].join('\n');

    const shown = ConsentsService.forPatient(document);

    expect(shown).toBe('## Kim, neyi onaylıyor');
    expect(shown).not.toContain('avukat');
  });

  /// A clinic editing the file must not be able to lose half of it to a rule
  /// it cannot see. No marker means the whole document.
  it('serves everything when there is no marker', () => {
    const document = '# Onam Formu\n\n## Kim, neyi onaylıyor';

    expect(ConsentsService.forPatient(document)).toBe(document);
  });

  it('keeps a marker that appears later in the text alone', () => {
    const document = '<!-- ONAM-BASLANGIC -->\nBir\n\nİki';

    expect(ConsentsService.forPatient(document)).toBe('Bir\n\nİki');
  });
});

describe('ConsentsService.day', () => {
  /// The date somebody reads, in the clinic's own zone — a patient in Berlin
  /// reading an operation date shifted by an hour is reading the wrong day.
  it('reads as a day, not a timestamp', () => {
    expect(ConsentsService.day(new Date('2026-11-02T09:00:00.000Z'))).toBe('02 Kasım 2026');
  });

  it('uses the clinic timezone, not the server one', () => {
    // 22:30 UTC is already the next day in Istanbul.
    expect(ConsentsService.day(new Date('2026-11-02T22:30:00.000Z'))).toBe('03 Kasım 2026');
  });
});
