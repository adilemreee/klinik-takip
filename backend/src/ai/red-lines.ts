/**
 * Section 14 of the specification, written down once.
 *
 * These four sentences were in two prompt files with two slightly different
 * wordings, which is how a rule stops being a rule: the third prompt copies
 * whichever version it happened to see, the fourth paraphrases, and a year
 * later nobody can say what the system actually promises. They live here now,
 * and every prompt renders the same block.
 *
 * The suite in `red-lines.spec.ts` is the other half of T5.7. It checks that
 * every prompt carries this block, that every call site declares its patient
 * data, that nothing outside this directory can reach a provider, and that the
 * structural guarantees hold — because a rule stated in a prompt is a request
 * to the model, and only the structure around it is a control.
 */

export const RED_LINES = [
  'Tanı koymazsın.',
  'İlaç dozu önermez ve değiştirmezsin.',
  'Tedavi önermezsin.',
  'Emin olmadığında kendin karar vermez, insana devredersin.',
] as const;

/**
 * Explains the redaction placeholders wherever a prompt can carry patient text.
 *
 * Without it a model reads `[ad]` as something the patient typed and sometimes
 * tries to fill it back in, which is the one thing the scrubber exists to
 * prevent it having.
 */
export const PLACEHOLDER_NOTE = [
  'Köşeli parantez içindeki [ad], [telefon], [e-posta], [dosya-no] ve',
  '[kimlik-no] gibi ifadeler, gönderilmeden önce çıkarılmış kimlik bilgileridir.',
  'Onları hastanın yazdığı metin sanma ve geri yazmaya çalışma.',
].join('\n');

/**
 * The block as it appears in a system prompt, with any rules a particular use
 * adds after the shared ones.
 */
export function redLinesBlock(extra: readonly string[] = []): string {
  return ['Kesin kurallar:', ...[...RED_LINES, ...extra].map((line) => `- ${line}`)].join('\n');
}
