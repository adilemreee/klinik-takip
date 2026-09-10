import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AiJobType, Message } from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { redact } from '../ai/pseudonymise';
import { type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { PrismaService } from '../infra/prisma.service';

/**
 * The prompt.
 *
 * "Translate" and nothing else: a model asked to be helpful with a medical
 * complaint will summarise it, soften it, or answer it, and any of those
 * reaching a clinician as if the patient had written them is worse than no
 * translation at all.
 */
const SYSTEM_PROMPT = [
  'You translate messages between a patient and a clinic.',
  'Translate the text into the requested language and output nothing else.',
  'Do not summarise, interpret, answer, correct or add anything.',
  'Keep the register: an anxious message stays anxious, a blunt one stays blunt.',
  'Keep numbers, units, dose amounts and times exactly as written.',
  'Placeholders in square brackets such as [ad] stand in for a redacted name.',
  'Leave them exactly as they are; do not translate or invent a name for them.',
  'Answer as JSON: {"language":"<BCP-47 tag of the source>","text":"<translation>"}',
].join('\n');

interface Translated {
  language: string | null;
  text: string;
}

/**
 * Translating a message (spec M3).
 *
 * Three decisions shape this, and the first two are the spec's:
 *
 *   1. **The original is never replaced.** The translation is stored beside
 *      `body`, and every screen that shows one offers the other. What a patient
 *      actually wrote is the clinical record; a translation is a reading of it.
 *   2. **On request, not on arrival.** Translating every message as it lands
 *      would send the whole conversation to a provider whether or not anybody
 *      needed it — and most messages between a Turkish clinic and a Turkish
 *      patient need nothing. The first person to ask pays for it; everyone
 *      after reads the stored one.
 *   3. **The text is scrubbed first.** People sign their messages, and the AI
 *      gate refuses a prompt carrying a patient's name. So names are replaced
 *      with `[ad]` before the text goes, and the translation comes back with
 *      the placeholder still in it. That is not a defect: the reader is shown
 *      the original alongside, where the name is.
 */
@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly access: PatientAccessService,
  ) {}

  async translate(user: AuthenticatedUser, messageId: string, to: string): Promise<Message> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: {
          select: {
            patientId: true,
            patient: {
              select: {
                firstName: true,
                lastName: true,
                mrn: true,
                user: { select: { phone: true, email: true } },
              },
            },
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    await this.access.assertCanAccess(user, message.conversation.patientId);

    const source = message.body ?? message.transcript;

    if (!source || source.trim().length === 0) {
      // An attachment with no words. Nothing to translate, and inventing a
      // caption for it would be the model describing a file it cannot see.
      return message;
    }

    // Already done, in the language being asked for. Spending a second call to
    // produce the same sentence is spending the clinic's money on nothing.
    if (message.translatedTo === to && message.translatedText) {
      return message;
    }

    const patient = message.conversation.patient;
    const identifiers = {
      names: [patient.firstName, patient.lastName],
      mrn: patient.mrn,
      phone: patient.user?.phone ?? null,
      email: patient.user?.email ?? null,
    };

    const scrubbed = redact(source, identifiers);

    const result = await this.ai.complete({
      purpose: AiJobType.TRANSLATION,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Target language: ${to}\n\n${scrubbed.text}` }],
      containsHealthData: true,
      identifiers,
      patientId: message.conversation.patientId,
      // A message, not an essay. Room for the translation and the JSON around
      // it, and no room for the paragraph the prompt told it not to write.
      maxOutputTokens: 1_200,
      temperature: 0,
    });

    if (!result.ok) {
      // The caller is told by the message coming back untranslated, which the
      // screen already knows how to show. A half-translation is not offered.
      this.logger.warn(`Translation refused: ${result.reason}`);
      return message;
    }

    const parsed = TranslationService.parse(result.text);

    if (!parsed) {
      this.logger.warn('Translation could not be read as JSON');
      return message;
    }

    return this.prisma.message.update({
      where: { id: message.id },
      data: {
        translatedText: parsed.text,
        translatedTo: to,
        // Only if the model reported one and nothing has been recorded yet:
        // the source language does not change, and overwriting it on every
        // translation would let one confused answer rewrite a settled fact.
        originalLanguage: message.originalLanguage ?? parsed.language,
      },
    });
  }

  /**
   * Reads the model's answer.
   *
   * Nil rather than a guess when it cannot be read. Handing back the raw text
   * would put "Here is the translation:" or a fragment of JSON into a
   * clinician's message thread as if the patient had written it.
   */
  static parse(text: string): Translated | null {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start === -1 || end <= start) return null;

    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        language?: unknown;
        text?: unknown;
      };

      if (typeof parsed.text !== 'string' || parsed.text.trim().length === 0) {
        return null;
      }

      return {
        language: typeof parsed.language === 'string' ? parsed.language : null,
        text: parsed.text,
      };
    } catch {
      return null;
    }
  }
}
