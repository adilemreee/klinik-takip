import { PLACEHOLDER_NOTE, redLinesBlock } from '../ai/red-lines';
import { FINDINGS } from './assessment';

/**
 * The photo pre-assessment prompt (spec M5).
 *
 * The model is not asked what is wrong with the wound. It is asked which of
 * four things it can see, from a closed list, and told in as many ways as the
 * prompt has room for that the answer goes to a clinician and never to the
 * patient.
 *
 * The flag itself is computed from the findings rather than asked for, so the
 * only thing this prompt has to get right is the observation — and the only
 * thing a jailbroken answer could put into the system is a word that is not in
 * the vocabulary, which is dropped.
 */
export const SYSTEM_PROMPT = [
  'Sen bir klinik fotoğraf ön değerlendirme asistanısın. Sana bir yara',
  'fotoğrafı veriliyor ve yalnızca **ne gördüğünü** listeliyorsun.',
  '',
  redLinesBlock([
    'Hastalık adı yazmazsın. Bir durumun adını anmazsın.',
    'Yalnızca verilen listeden seçersin; listede olmayan hiçbir şey yazmazsın.',
    'Emin olmadığın bulguyu listelemezsin.',
    'Yanıtın hastaya gösterilmez; yalnızca klinik personeline gider.',
  ]),
  '',
  PLACEHOLDER_NOTE,
  '',
  'Seçebileceğin bulgular:',
  '- redness: yara çevresinde kızarıklık',
  '- discharge: yaradan akıntı',
  '- swelling: yara çevresinde şişlik',
  '- wound-open: yara kenarlarının ayrılmış görünmesi',
  '',
  'Hiçbirini görmüyorsan boş liste döndür. Fotoğraf değerlendirilemeyecek',
  'kadar bulanık, karanlık ya da alakasızsa da boş liste döndür.',
  '',
  'Yalnızca şu JSON nesnesini döndür, başka hiçbir şey yazma:',
  `{"findings":[${FINDINGS.map((finding) => `"${finding}"`).join('|')}]}`,
].join('\n');

export interface PhotoContext {
  daysSinceSurgery: number | null;
  bodyArea: string | null;
}

/**
 * The little context that changes how a wound reads.
 *
 * Redness on day two and on day ninety are different observations. Nothing else
 * goes: no name, no age, no note the patient wrote — the model is looking at a
 * picture and answering four yes-or-no questions about it.
 */
export function buildUserPrompt(context: PhotoContext): string {
  return [
    'Bu yara fotoğrafında yukarıdaki bulgulardan hangilerini görüyorsun?',
    '',
    'Bağlam:',
    context.daysSinceSurgery === null
      ? '- Ameliyat kaydı yok'
      : `- Ameliyattan bu yana ${context.daysSinceSurgery} gün geçti`,
    `- Vücut bölgesi: ${context.bodyArea ?? 'belirtilmemiş'}`,
  ].join('\n');
}
