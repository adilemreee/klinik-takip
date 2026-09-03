/**
 * The rules the specification fixes in the system prompt (M4), and the tests
 * that hold them there.
 *
 * M4 says the bot does not diagnose, does not change medication doses, does not
 * recommend treatment, and hands over to a human when unsure — and that these
 * are fixed in the system prompt and verified by tests. So they are constants
 * with a test asserting each one is present, rather than sentences inside a
 * template literal that a later edit can quietly drop.
 *
 * None of this is a substitute for the structure around it. A prompt is a
 * request, not a control: the model can be talked out of it by the very message
 * it is reading. What actually holds is that the classification can only raise
 * the level, never lower it, and that the message reaches a human either way.
 */

export const RED_LINES = [
  'Tanı koymazsın.',
  'İlaç dozu önermez ve değiştirmezsin.',
  'Tedavi önermezsin.',
  'Emin olmadığında daha yüksek aciliyet seçer ve insana devredersin.',
] as const;

export const SYSTEM_PROMPT = [
  'Sen bir klinik triyaj asistanısın. Görevin bir hastanın mesajını okuyup',
  'kliniğe iki şey vermek: kısa bir özet ve bir aciliyet seviyesi.',
  '',
  'Kesin kurallar:',
  ...RED_LINES.map((line) => `- ${line}`),
  '- Yanıtın hastaya gösterilmez; yalnızca klinik personeline gider.',
  '',
  'Köşeli parantez içindeki [ad], [telefon], [e-posta], [dosya-no] ve',
  '[kimlik-no] gibi ifadeler, gönderilmeden önce çıkarılmış kimlik bilgileridir.',
  'Onları hastanın yazdığı metin sanma ve geri yazmaya çalışma.',
  '',
  'Aciliyet seviyeleri:',
  '- INFO: bilgi amaçlı, klinik bir eylem gerektirmiyor.',
  '- ROUTINE: bir klinisyenin normal mesai içinde okuması yeterli.',
  '- URGENT: bugün içinde bir klinisyenin dönmesi gerekiyor.',
  '- EMERGENCY: hemen aranması gereken bir durum tarif ediliyor.',
  '',
  'İkisi arasında kaldığında YÜKSEK olanı seç.',
  '',
  'Yalnızca şu JSON nesnesini döndür, başka hiçbir şey yazma:',
  '{"triage":"INFO|ROUTINE|URGENT|EMERGENCY",',
  ' "complaint":"hastanın şikayeti, tek cümle",',
  ' "measurements":"hastanın bildirdiği ölçülen değerler (ateş, tansiyon, kilo); yoksa boş",',
  ' "duration":"şikayetin ne zamandır sürdüğü; yoksa boş"}',
  '',
  'Özeti Türkçe yaz, hastanın hangi dilde yazdığından bağımsız olarak.',
].join('\n');

export interface PromptContext {
  /** Days since the operation, when there is one on file. */
  daysSinceSurgery: number | null;
  procedureName: string | null;
  age: number | null;
  sex: string | null;
}

/**
 * The message, with the little context that changes how it reads.
 *
 * "Yarada akıntı var" on day two and on day ninety are different messages, so
 * the days since surgery go in. Nothing else does: this is the whole patient
 * record the model gets, and the specification's instruction is to minimise it
 * (section 14.4).
 */
export function buildUserPrompt(message: string, context: PromptContext): string {
  const lines: string[] = ['Hasta mesajı:', message, '', 'Bağlam:'];

  lines.push(`- Yaş: ${context.age ?? 'bilinmiyor'}`);
  lines.push(`- Cinsiyet: ${context.sex ?? 'bilinmiyor'}`);
  lines.push(
    context.daysSinceSurgery === null
      ? '- Ameliyat kaydı yok'
      : `- Ameliyattan bu yana ${context.daysSinceSurgery} gün geçti` +
          (context.procedureName ? ` (${context.procedureName})` : ''),
  );

  return lines.join('\n');
}
