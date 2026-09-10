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
