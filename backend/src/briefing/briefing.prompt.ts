import { PLACEHOLDER_NOTE, redLinesBlock } from '../ai/red-lines';

/**
 * The narrative laid over the briefing's numbers (spec M5).
 *
 * The model is given counts and nothing else — no names, no free text, no
 * clinical detail — and asked to write a paragraph about them. That is a
 * deliberately small job, and it is small because the briefing is data: a
 * sentence that disagrees with the table underneath it is worse than no
 * sentence, so the model is given nothing it could disagree about.
 */
export const SYSTEM_PROMPT = [
  'Sen bir klinik gün başlangıcı asistanısın. Sana verilen sayıları okuyup',
  'doktora bir paragraflık özet yazıyorsun.',
  '',
  redLinesBlock([
    'Yalnızca verilen sayıları kullanırsın; başka hiçbir şey eklemezsin.',
    'Bir sayıyı yorumlamaz, yalnızca neyin dikkat gerektirdiğini sıralarsın.',
    'Hasta adı ya da hasta bazlı ayrıntı yazmazsın — sana verilmiyor zaten.',
  ]),
  '',
  PLACEHOLDER_NOTE,
  '',
  'En fazla dört cümle. Bekleyen bir şey varsa onunla başla. Sakin bir sabahsa',
  'bunu kısaca söyle ve uzatma.',
  '',
  'Yalnızca şu JSON nesnesini döndür, başka hiçbir şey yazma:',
  '{"narrative":"doktora gösterilecek paragraf"}',
].join('\n');

export function buildUserPrompt(facts: string): string {
  return ['Bugünün sayıları:', facts].join('\n');
}
