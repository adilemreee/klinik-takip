import { emergencyNumberFor, type EmergencyNumber } from './emergency-numbers';

/**
 * The "what to do until we reach you" card (spec M8).
 *
 * Deliberately **logistics, not treatment**. Every line here is something that
 * makes the clinic reach the patient faster or makes the next hour go better,
 * and none of it is advice about their condition. That boundary is not
 * squeamishness: an app that tells a post-operative patient in another country
 * what to do about their symptoms is practising medicine through a phone, in a
 * language it guessed, without seeing them.
 *
 * The one clinically-shaped line is the first, and it points *away* from the
 * clinic: if this is life-threatening, dial the local ambulance now rather than
 * wait for a call from Istanbul. A patient who cannot breathe must not spend
 * their minutes waiting on a message thread.
 *
 * The clinic is expected to replace this text with its own; what the code
 * guarantees is that the card is never empty and never omits the first line.
 */

export interface GuidanceStep {
  /** Stable id so the clients can pick an icon without parsing the text. */
  id: string;
  text: string;
  /** Rendered as the emphasised, tappable line. Exactly one step has it. */
  critical: boolean;
}

export interface EmergencyGuidance {
  language: string;
  emergencyNumber: EmergencyNumber;
  steps: GuidanceStep[];
}

type Localised = Record<string, string>;

interface StepTemplate {
  id: string;
  text: Localised;
  critical?: boolean;
}

const STEPS: StepTemplate[] = [
  {
    id: 'call-local',
    critical: true,
    text: {
      tr: 'Nefes darlığı, göğüs ağrısı, durdurulamayan kanama veya bayılma varsa bizi beklemeyin — hemen {number} numarasını arayın.',
      en: 'If you have trouble breathing, chest pain, bleeding that will not stop, or you are fainting, do not wait for us — call {number} now.',
    },
  },
  {
    id: 'stay-put',
    text: {
      tr: 'Bulunduğunuz yerde kalın ve kendiniz araç kullanmayın.',
      en: 'Stay where you are, and do not drive yourself.',
    },
  },
  {
    id: 'tell-someone',
    text: {
      tr: 'Yanınızdaki birine haber verin; yalnızsanız kapıyı kilitlemeyin.',
      en: 'Tell someone who is with you; if you are alone, leave the door unlocked.',
    },
  },
  {
    id: 'keep-line-open',
    text: {
      tr: 'Telefonunuzu açık ve meşgul etmeden yanınızda tutun; sizi arayacağız.',
      en: 'Keep your phone with you, switched on and free; we will call you.',
    },
  },
  {
    id: 'nil-by-mouth',
    text: {
      tr: 'Bir şey yiyip içmeyin — acil bir işlem gerekirse dolu mide onu geciktirir.',
      en: 'Do not eat or drink anything — a full stomach delays an urgent procedure.',
    },
  },
  {
    id: 'gather-medication',
    text: {
      tr: 'Kullandığınız ilaçların kutularını yanınıza alın.',
      en: 'Gather the boxes of the medication you are taking.',
    },
  },
];

/**
 * Falls back to Turkish per language, not per card: a half-Turkish,
 * half-English list reads as a broken app at the moment the patient most needs
 * to trust it.
 */
export function buildGuidance(
  country: string | null | undefined,
  language: string | null | undefined,
): EmergencyGuidance {
  const emergencyNumber = emergencyNumberFor(country);
  const requested = (language ?? 'tr').slice(0, 2).toLowerCase();
  const lang = STEPS.every((step) => step.text[requested]) ? requested : 'tr';

  return {
    language: lang,
    emergencyNumber,
    steps: STEPS.map((step) => ({
      id: step.id,
      text: (step.text[lang] ?? step.text.tr!).replace('{number}', emergencyNumber.number),
      critical: step.critical ?? false,
    })),
  };
}
