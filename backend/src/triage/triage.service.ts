import { Injectable, Logger } from '@nestjs/common';
import { AiJobType, MessageStatus, MessageType, Role, TriageLevel } from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { ageFrom, redact } from '../ai/pseudonymise';
import { CareTeamService } from '../authz/care-team.service';
import { PrismaService } from '../infra/prisma.service';
import { MessagingGateway } from '../messaging/messaging.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/templates';
import { screen } from './red-flags';
import {
  hasContent,
  needsImmediateAttention,
  parseVerdict,
  raiseTo,
  renderSummary,
  type TriageVerdict,
} from './triage';
import { SYSTEM_PROMPT, buildUserPrompt } from './triage.prompt';

export interface TriageOutcome {
  messageId: string;
  level: TriageLevel;
  flags: string[];
  /** What the model said, or null when it was not asked or did not answer. */
  aiLevel: TriageLevel | null;
  released: boolean;
  notified: number;
}

@Injectable()
export class TriageService {
  private readonly logger = new Logger(TriageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly careTeam: CareTeamService,
    private readonly notifications: NotificationsService,
    private readonly gateway: MessagingGateway,
  ) {}

  /**
   * Reads one patient message and decides how loudly to say it arrived.
   *
   * Two passes, and the order matters. The keyword screen runs first and always
   * — it is what makes this work with the AI switched off, unpaid for or
   * unreachable, which is the state the system ships in. The model then reads
   * the same message and may raise the level further; it can never lower it.
   */
  async triage(messageId: string): Promise<TriageOutcome | null> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: {
          select: {
            id: true,
            patientId: true,
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                mrn: true,
                birthDate: true,
                sex: true,
                user: { select: { phone: true, email: true, role: true } },
                surgeries: { orderBy: { performedAt: 'desc' }, take: 1 },
              },
            },
          },
        },
      },
    });

    if (!message?.body) return null;
    if (message.type !== MessageType.TEXT) return null;

    // Only what a patient wrote. A clinician's own message does not need
    // triaging, and running it through would put clinic text into a model for
    // no clinical gain.
    const sender = message.senderId
      ? await this.prisma.user.findUnique({
          where: { id: message.senderId },
          select: { role: true },
        })
      : null;

    if (sender?.role !== Role.PATIENT && sender?.role !== Role.CAREGIVER) return null;

    const patient = message.conversation.patient;
    const screening = screen(message.body);

    const verdict = await this.askTheModel(message.body, message.id, patient);
    const level = raiseTo(screening.level, verdict?.level ?? null);

    const summary =
      verdict && hasContent(verdict.summary) ? renderSummary(verdict.summary) : null;

    await this.prisma.message.update({
      where: { id: message.id },
      data: {
        triageLevel: level,
        triageFlags: screening.matched,
        aiTriageLevel: verdict?.level ?? null,
        aiSummary: summary,
      },
    });

    if (!needsImmediateAttention(level)) {
      return {
        messageId: message.id,
        level,
        flags: screening.matched,
        aiLevel: verdict?.level ?? null,
        released: false,
        notified: 0,
      };
    }

    const released = await this.release(message.id, message.conversationId, message.status);
    const notified = await this.tellTheCareTeam(patient.id, message.conversationId, message.id, level);

    this.logger.warn(
      `Message ${message.id} triaged ${level}` +
        (screening.matched.length > 0 ? ` (${screening.matched.join(', ')})` : '') +
        `; told ${notified} staff`,
    );

    return {
      messageId: message.id,
      level,
      flags: screening.matched,
      aiLevel: verdict?.level ?? null,
      released,
      notified,
    };
  }

  /**
   * The AI half, and every way it can decline to happen.
   *
   * The message is scrubbed before it goes: people sign their messages, and
   * refusing every one that says "Ben Ayşe" would leave exactly those messages
   * without a summary. The gate still checks afterwards, so what the scrubber
   * missed is caught there and the call is refused rather than sent.
   */
  private async askTheModel(
    body: string,
    messageId: string,
    patient: {
      id: string;
      firstName: string;
      lastName: string;
      mrn: string;
      birthDate: Date;
      sex: string;
      user: { phone: string | null; email: string | null } | null;
      surgeries: { procedureName: string; performedAt: Date }[];
    },
  ): Promise<TriageVerdict | null> {
    if (!this.ai.enabled) return null;

    const identifiers = {
      names: [patient.firstName, patient.lastName],
      mrn: patient.mrn,
      phone: patient.user?.phone ?? null,
      email: patient.user?.email ?? null,
    };

    const scrubbed = redact(body, identifiers);
    const surgery = patient.surgeries[0] ?? null;

    const result = await this.ai.complete({
      purpose: AiJobType.TRIAGE,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserPrompt(scrubbed.text, {
            daysSinceSurgery: surgery
              ? Math.max(0, Math.floor((Date.now() - surgery.performedAt.getTime()) / 86_400_000))
              : null,
            procedureName: surgery?.procedureName ?? null,
            age: ageFrom(patient.birthDate),
            sex: patient.sex,
          }),
        },
      ],
      containsHealthData: true,
      identifiers,
      patientId: patient.id,
      // Three lines of summary and a word. More room would only give the model
      // space to write the paragraph the prompt told it not to.
      maxOutputTokens: 400,
      temperature: 0,
    });

    if (!result.ok) {
      // Not an error the clinic needs to see: the keyword screen already
      // decided, and the message is on its way to a human either way.
      this.logger.log(`Triage for message ${messageId} had no AI reading (${result.reason})`);
      return null;
    }

    const verdict = parseVerdict(result.text);

    if (verdict === null) {
      this.logger.warn(`Triage for message ${messageId}: the model's answer could not be read`);
      return null;
    }

    return verdict;
  }

  /**
   * An urgent message does not wait for the access window.
   *
   * This is the case the whole feature exists for. A patient writes "nefes
   * alamıyorum" at three in the morning, the window says the clinic reads
   * messages at six in the evening, and without this the message sits invisible
   * for fifteen hours. The window is there so a doctor is not on call all night
   * for routine questions — it was never meant to hold this.
   */
  private async release(
    messageId: string,
    conversationId: string,
    status: MessageStatus,
  ): Promise<boolean> {
    if (status !== MessageStatus.QUEUED) return false;

    const released = await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.SENT, queuedUntil: null },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: released.createdAt },
    });

    this.gateway.emitMessage(conversationId, released);

    return true;
  }

  private async tellTheCareTeam(
    patientId: string,
    conversationId: string,
    messageId: string,
    level: TriageLevel,
  ): Promise<number> {
    const recipients = await this.careTeam.everyone(patientId);
    const created = [];

    for (const userId of recipients) {
      const notification = await this.notifications.dispatch({
        userId,
        type: NOTIFICATION_TYPES.messageUrgent,
        data: { conversationId, messageId, triageLevel: level },
      });

      if (notification) created.push(notification);
    }

    // Sent now rather than at the next delivery sweep, for the same reason the
    // emergency alerts are: half a minute is a long time in this path.
    await this.notifications.deliverNow(created);

    return created.length;
  }
}
