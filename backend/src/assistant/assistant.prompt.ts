import { PLACEHOLDER_NOTE, redLinesBlock } from '../ai/red-lines';

/**
 * The FAQ assistant (spec M4).
 *
 * This is the first thing in the system that talks to a patient directly, and
 * the rule it exists under is narrow: it answers **only** from the clinic's own
 * protocol documents. The prompt says so, and — because a prompt is a request
 * rather than a control — the code around it says so twice: the model is not
 * called at all when retrieval came back thin, and an answer that cites nothing
 * is thrown away.
 *
 * "Emin olmadığında insana devredersin" is not a politeness here. Deferring is
 * the *expected* outcome for anything the corpus does not cover, and the clinic
 * would rather answer a hundred questions itself than have one answered from a
 * model's memory.
 */
export const SYSTEM_PROMPT = [
  'Sen bir klinik SSS asistanısın. Hastanın sorusunu, YALNIZCA sana verilen',
  'klinik doküman parçalarından yanıtlarsın.',
  '',
  redLinesBlock([
    'Verilen parçalarda olmayan hiçbir bilgiyi kullanmazsın — kendi genel',
    'bilgini kullanman yasaktır.',
    'Parçalar soruyu yanıtlamıyorsa yanıtlamaz, insana devredersin.',
    'Yanıtladığın her cümle, kaynak gösterdiğin parçalardan çıkmalıdır.',
  ]),
  '',
  PLACEHOLDER_NOTE,
  '',
  'Yanıtın doğrudan hastaya gösterilecek. Sade, kısa cümleler kur. Hastayı',
  'korkutma, ama bir şeyi bilmediğinde bildiğini varsaymaktan iyidir.',
  '',
  'Yalnızca şu JSON nesnesini döndür, başka hiçbir şey yazma:',
  '{"answered":true|false,',
  ' "answer":"hastaya gösterilecek yanıt; answered false ise boş",',
  ' "citations":[kullandığın parça numaraları],',
  ' "handoverReason":"answered false ise tek cümlelik sebep"}',
].join('\n');

export interface AssistantContext {
  daysSinceSurgery: number | null;
  procedureName: string | null;
}

export function buildUserPrompt(
  question: string,
  sources: string,
  context: AssistantContext,
): string {
  return [
    'Klinik doküman parçaları:',
    sources,
    '',
    'Hastanın sorusu:',
    question,
    '',
    'Bağlam:',
    context.daysSinceSurgery === null
      ? '- Ameliyat kaydı yok'
      : `- Ameliyattan bu yana ${context.daysSinceSurgery} gün geçti` +
        (context.procedureName ? ` (${context.procedureName})` : ''),
  ].join('\n');
}

export interface AssistantAnswer {
  answered: boolean;
  answer: string;
  citations: number[];
  handoverReason: string;
}

/**
 * Reads the model's answer, and treats everything it cannot read as a handover.
 *
 * The default here is the safe one and it is the opposite of the usual: where
 * the triage parser returns null so the floor stands, this one returns "no
 * answer, give it to a person" — because an unreadable reply from an assistant
 * that speaks to patients must never become a reply.
 */
export function parseAnswer(raw: string): AssistantAnswer | null {
  const json = extractObject(raw);
  if (json === null) return null;

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const answered = record.answered === true;
  const answer = typeof record.answer === 'string' ? record.answer.trim().slice(0, 4_000) : '';
  const citations = Array.isArray(record.citations)
    ? record.citations.filter((value): value is number => typeof value === 'number')
    : [];

  return {
    // An answer with no text is not an answer, however confidently it was
    // labelled one.
    answered: answered && answer.length > 0,
    answer,
    citations,
    handoverReason:
      typeof record.handoverReason === 'string' ? record.handoverReason.trim().slice(0, 300) : '',
  };
}

function extractObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, index + 1);
    }
  }

  return null;
}
