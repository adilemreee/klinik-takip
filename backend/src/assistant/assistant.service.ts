import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AiJobType, Message, MessageType } from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { redact } from '../ai/pseudonymise';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../infra/prisma.service';
import { MessagingGateway } from '../messaging/messaging.gateway';
import { citedChunks, renderSources, type Retrieved } from '../protocols/retrieval';
import { ProtocolsService } from '../protocols/protocols.service';
import { TriageService } from '../triage/triage.service';
import { SYSTEM_PROMPT, buildUserPrompt, parseAnswer } from './assistant.prompt';

export type HandoverReason =
  | 'no-sources'
  | 'model-declined'
  | 'no-citations'
  | 'ai-unavailable';

export interface AssistantResult {
  /** The patient's question, as stored — the handle for "this is not enough". */
  questionMessageId: string;
  answered: boolean;
  answer: string | null;
  /** Titles of the clinic documents the answer came from. */
  sources: string[];
  handoverReason: HandoverReason | null;
}

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly protocols: ProtocolsService,
    private readonly triage: TriageService,
    private readonly gateway: MessagingGateway,
  ) {}

  /**
   * The chatbot the specification puts in front of the message box (M4).
   *
   * The question is written into the conversation either way, because "all bot
   * conversations are viewable in the doctor's panel" and because a question
   * the bot could not answer *is* a message to the clinic. What changes is
   * whether a bot reply lands under it or the clinic does.
   */
  async ask(user: AuthenticatedUser, patientId: string, question: string): Promise<AssistantResult> {
    const text = question.trim();

    if (text.length < 3) {
      throw new BadRequestException('Ask a question');
    }

    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        mrn: true,
        user: { select: { phone: true, email: true } },
        surgeries: { orderBy: { performedAt: 'desc' }, take: 1 },
      },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    const conversationId = await this.conversationFor(patientId);

    const questionMessage = await this.prisma.message.create({
      data: {
        conversationId,
        senderId: user.id,
        type: MessageType.TEXT,
        body: text.slice(0, 4000),
      },
    });

    this.gateway.emitMessage(conversationId, questionMessage);

    const surgery = patient.surgeries[0] ?? null;
    const evidence = await this.protocols.retrieve(text, surgery?.procedureName ?? null);

    if (!evidence.sufficient) {
      // Nothing in the corpus is about this. The bot does not improvise; a
      // person answers.
      return this.handOver(questionMessage, 'no-sources', []);
    }

    if (!this.ai.enabled) {
      return this.handOver(questionMessage, 'ai-unavailable', []);
    }

    const identifiers = {
      names: [patient.firstName, patient.lastName],
      mrn: patient.mrn,
      phone: patient.user?.phone ?? null,
      email: patient.user?.email ?? null,
    };

    const result = await this.ai.complete({
      purpose: AiJobType.ASSISTANT,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserPrompt(
            redact(text, identifiers).text,
            renderSources(evidence.chunks),
            {
              daysSinceSurgery: surgery
                ? Math.max(
                    0,
                    Math.floor((Date.now() - surgery.performedAt.getTime()) / 86_400_000),
                  )
                : null,
              procedureName: surgery?.procedureName ?? null,
            },
          ),
        },
      ],
      containsHealthData: true,
      identifiers,
      patientId,
      maxOutputTokens: 800,
      temperature: 0.1,
    });

    if (!result.ok) {
      return this.handOver(questionMessage, 'ai-unavailable', []);
    }

    const parsed = parseAnswer(result.text);

    if (parsed === null || !parsed.answered) {
      return this.handOver(questionMessage, 'model-declined', []);
    }

    /**
     * The citation check, which is the rule made mechanical.
     *
     * An answer citing nothing, or citing a passage that was not in front of
     * it, came from somewhere other than the corpus — and that is the one thing
     * this assistant is not allowed to produce, whatever the prompt asked for.
     */
    const cited = citedChunks(parsed.citations, evidence.chunks);

    if (cited.length === 0) {
      this.logger.warn(`Assistant answer for ${patientId} cited nothing; handing over`);
      return this.handOver(questionMessage, 'no-citations', []);
    }

    // A truncated answer to a patient is worse than no answer: the caveat is
    // usually the last sentence.
    if (result.truncated) {
      return this.handOver(questionMessage, 'model-declined', []);
    }

    return this.reply(conversationId, questionMessage, parsed.answer, cited);
  }

  /**
   * "This answer is not enough, send it to a doctor" (spec M4).
   *
   * The question is triaged exactly as if the bot had never answered, so an
   * urgent one still escalates — the patient pressing this button is not a
   * clinical judgement about how urgent they are.
   */
  async escalate(user: AuthenticatedUser, messageId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true, conversation: { select: { patient: { select: { userId: true } } } } },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    const ownsIt =
      message.senderId === user.id || message.conversation.patient.userId === user.id;

    if (!ownsIt) {
      throw new NotFoundException('Message not found');
    }

    await this.triage.triage(messageId);
  }

  /** The bot's reply, stored where the doctor's panel already looks. */
  private async reply(
    conversationId: string,
    question: Message,
    answer: string,
    cited: Retrieved[],
  ): Promise<AssistantResult> {
    const sources = [...new Set(cited.map((chunk) => chunk.documentTitle))];

    const body = [answer, '', `Kaynak: ${sources.join(', ')}`].join('\n');

    const botMessage = await this.prisma.message.create({
      data: {
        conversationId,
        // No sender: this was not a person, and attributing it to one is how a
        // patient ends up believing a clinician said it.
        senderId: null,
        type: MessageType.BOT,
        body,
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: botMessage.createdAt },
    });

    this.gateway.emitMessage(conversationId, botMessage);

    return {
      questionMessageId: question.id,
      answered: true,
      answer: body,
      sources,
      handoverReason: null,
    };
  }

  /**
   * Giving the question to a person.
   *
   * Triaged on the way, so a question the bot could not answer because it was
   * about something alarming does not sit in the ordinary queue.
   */
  private async handOver(
    question: Message,
    reason: HandoverReason,
    sources: string[],
  ): Promise<AssistantResult> {
    await this.triage.triage(question.id).catch((error: unknown) => {
      this.logger.error(`Could not triage handed-over question ${question.id}: ${String(error)}`);
    });

    return {
      questionMessageId: question.id,
      answered: false,
      answer: null,
      sources,
      handoverReason: reason,
    };
  }

  private async conversationFor(patientId: string): Promise<string> {
    const existing = await this.prisma.conversation.findFirst({
      where: { patientId, closedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (existing) return existing.id;

    const created = await this.prisma.conversation.create({ data: { patientId } });

    return created.id;
  }
}
