import { Injectable, Logger } from '@nestjs/common';
import {
  AiJobType,
  ComplicationStatus,
  EmergencyStatus,
  LabFlag,
  MilestoneStatus,
  Prisma,
  TriageLevel,
} from '@prisma/client';
import { AIService } from '../ai/ai.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PatientAccessService } from '../authz/patient-access.service';
import { OVERDUE_AFTER_MINUTES } from '../complications/complications.service';
import { RedisService } from '../infra/redis.service';
import { PrismaService } from '../infra/prisma.service';
import {
  dayWindow,
  isQuiet,
  orderRisks,
  parseNarrative,
  renderFacts,
  type BriefingFacts,
  type RiskItem,
} from './briefing';
import { SYSTEM_PROMPT, buildUserPrompt } from './briefing.prompt';

/**
 * How far back an unanswered urgent message still counts as today's problem.
 *
 * Three days: past that it is not a thing the morning briefing surfaces, it is
 * a thing that has gone wrong with the clinic's process, and a list that keeps
 * showing it teaches people to scroll past the top of the briefing.
 */
const URGENT_LOOKBACK_DAYS = 3;

/** At most this many names, so the list stays something a person reads. */
const MAX_RISK_ITEMS = 20;

/**
 * The narrative is cached for the day.
 *
 * A doctor refreshes the morning screen several times; regenerating a paragraph
 * about unchanged numbers each time spends the clinic's budget on the same
 * sentence. Keyed by the facts themselves, so a briefing that changes gets a
 * new paragraph immediately.
 */
const NARRATIVE_TTL_SECONDS = 12 * 60 * 60;

export interface Briefing {
  facts: BriefingFacts;
  /** Null when the AI layer is off, refused, or unreadable — the facts stand alone. */
  narrative: string | null;
  quiet: boolean;
}

@Injectable()
export class BriefingService {
  private readonly logger = new Logger(BriefingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly ai: AIService,
    private readonly redis: RedisService,
  ) {}

  /**
   * "Dün ne oldu, bugün ne var, kim risk altında" (spec M5).
   *
   * Scoped like every clinical read, so a nurse's briefing is about her
   * patients and a doctor's is about theirs.
   */
  async forUser(user: AuthenticatedUser, now = new Date()): Promise<Briefing> {
    const scope = await this.access.scopeFilter(user);
    const facts = await this.gather(scope, now);

    return {
      facts,
      narrative: await this.narrativeFor(user.id, facts),
      quiet: isQuiet(facts),
    };
  }

  /** Who should be told there is a briefing waiting this morning. */
  async recipientsWithBriefings(userIds: string[], now = new Date()): Promise<string[]> {
    const worth: string[] = [];

    for (const userId of userIds) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      });

      if (!user) continue;

      const scope = await this.access.scopeFilter({ id: user.id, role: user.role } as AuthenticatedUser);
      const facts = await this.gather(scope, now);

      // A notification for a morning with nothing in it is the notification
      // that teaches people to ignore the rest.
      if (!isQuiet(facts)) worth.push(userId);
    }

    return worth;
  }

  private async gather(scope: Prisma.PatientWhereInput, now: Date): Promise<BriefingFacts> {
    const window = dayWindow(now);
    const yesterday = { gte: window.yesterdayStart, lt: window.todayStart };
    const today = { gte: window.todayStart, lt: window.todayEnd };

    const [
      newMessages,
      urgentMessages,
      emergencies,
      complications,
      criticalLabs,
      appointments,
      followUps,
    ] = await Promise.all([
      // Triaged messages are patient messages: the keyword screen runs on every
      // one of them and on nothing else.
      this.prisma.message.count({
        where: { conversation: { patient: scope }, createdAt: yesterday, triageLevel: { not: null } },
      }),
      this.prisma.message.count({
        where: {
          conversation: { patient: scope },
          createdAt: yesterday,
          triageLevel: { in: [TriageLevel.URGENT, TriageLevel.EMERGENCY] },
        },
      }),
      this.prisma.emergencyEvent.count({ where: { patient: scope, triggeredAt: yesterday } }),
      this.prisma.complication.count({ where: { patient: scope, reportedAt: yesterday } }),
      this.prisma.labResult.count({
        where: { patient: scope, flag: LabFlag.CRITICAL, verifiedAt: yesterday },
      }),
      this.prisma.appointment.count({ where: { patient: scope, scheduledAt: today } }),
      this.prisma.followUpMilestone.count({
        where: { schedule: { patient: scope }, dueAt: today },
      }),
    ]);

    return {
      generatedAt: now,
      window,
      yesterday: { newMessages, urgentMessages, emergencies, complications, criticalLabs },
      today: { appointments, followUps },
      atRisk: orderRisks(await this.risks(scope, now)).slice(0, MAX_RISK_ITEMS),
    };
  }

  /** Everything still waiting for somebody, whichever day it started on. */
  private async risks(scope: Prisma.PatientWhereInput, now: Date): Promise<RiskItem[]> {
    const overdueBefore = new Date(now.getTime() - OVERDUE_AFTER_MINUTES * 60_000);
    const urgentSince = new Date(now.getTime() - URGENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const [emergencies, urgent, overdue, missed, reports] = await Promise.all([
      this.prisma.emergencyEvent.findMany({
        where: { patient: scope, status: EmergencyStatus.TRIGGERED },
        orderBy: { triggeredAt: 'asc' },
        take: MAX_RISK_ITEMS,
        include: { patient: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.message.findMany({
        where: {
          conversation: { patient: scope },
          triageLevel: { in: [TriageLevel.URGENT, TriageLevel.EMERGENCY] },
          // Nobody at the clinic has opened it yet.
          readAt: null,
          createdAt: { gte: urgentSince },
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_RISK_ITEMS,
        include: {
          conversation: {
            select: { patient: { select: { id: true, firstName: true, lastName: true } } },
          },
        },
      }),
      this.prisma.complication.findMany({
        where: {
          patient: scope,
          status: ComplicationStatus.REPORTED,
          acknowledgedAt: null,
          reportedAt: { lt: overdueBefore },
        },
        orderBy: { reportedAt: 'asc' },
        take: MAX_RISK_ITEMS,
        include: { patient: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.followUpMilestone.findMany({
        where: { schedule: { patient: scope }, status: MilestoneStatus.MISSED },
        orderBy: { dueAt: 'asc' },
        take: MAX_RISK_ITEMS,
        include: {
          schedule: {
            select: { patient: { select: { id: true, firstName: true, lastName: true } } },
          },
        },
      }),
      this.prisma.aiReport.findMany({
        where: { patient: scope, reviewedAt: null },
        orderBy: { generatedAt: 'asc' },
        take: MAX_RISK_ITEMS,
        include: { patient: { select: { id: true, firstName: true, lastName: true } } },
      }),
    ]);

    const minutesSince = (at: Date): number =>
      Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));

    const name = (patient: { firstName: string; lastName: string }): string =>
      `${patient.firstName} ${patient.lastName}`;

    return [
      ...emergencies.map((event) => ({
        patientId: event.patient.id,
        patientName: name(event.patient),
        kind: 'emergency-unanswered' as const,
        detail: 'Acil çağrı yanıtlanmadı',
        waitingMinutes: minutesSince(event.triggeredAt),
      })),
      ...urgent.map((message) => ({
        patientId: message.conversation.patient.id,
        patientName: name(message.conversation.patient),
        kind: 'message-urgent' as const,
        // The message body is clinical content and stays out of a summary
        // screen; the level is what the doctor needs to decide where to look.
        detail:
          message.triageLevel === TriageLevel.EMERGENCY
            ? 'Çok acil sınıflandırılan mesaj okunmadı'
            : 'Acil sınıflandırılan mesaj okunmadı',
        waitingMinutes: minutesSince(message.createdAt),
      })),
      ...overdue.map((complication) => ({
        patientId: complication.patient.id,
        patientName: name(complication.patient),
        kind: 'complication-overdue' as const,
        detail: 'Komplikasyon bildirimi yanıtlanmadı',
        waitingMinutes: minutesSince(complication.reportedAt),
      })),
      ...missed.map((milestone) => ({
        patientId: milestone.schedule.patient.id,
        patientName: name(milestone.schedule.patient),
        kind: 'follow-up-missed' as const,
        detail: `${milestone.label} kontrolü kaçırıldı`,
        waitingMinutes: minutesSince(milestone.dueAt),
      })),
      ...reports.map((report) => ({
        patientId: report.patient.id,
        patientName: name(report.patient),
        kind: 'report-unreviewed' as const,
        detail: 'AI yorumu onay bekliyor',
        waitingMinutes: minutesSince(report.generatedAt),
      })),
    ];
  }

  /**
   * A paragraph over the numbers, when there is a model to write one.
   *
   * Failure here is not reported to the doctor as an error: the facts are the
   * briefing, and the paragraph was a convenience. A missing paragraph looks
   * like a briefing with no paragraph, which is what it is.
   */
  private async narrativeFor(userId: string, facts: BriefingFacts): Promise<string | null> {
    if (!this.ai.enabled) return null;

    const rendered = renderFacts(facts);
    const key = `briefing:${userId}:${hash(rendered)}`;

    const cached = await this.redis.client.get(key).catch(() => null);
    if (cached !== null) return cached;

    const result = await this.ai.complete({
      purpose: AiJobType.DAILY_BRIEFING,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(rendered) }],
      // Counts and kinds. No names, no free text, no clinical detail — the
      // narrative is about how many, never about whom.
      containsHealthData: false,
      maxOutputTokens: 400,
      temperature: 0.3,
    });

    if (!result.ok) {
      this.logger.log(`No briefing narrative for ${userId} (${result.reason})`);
      return null;
    }

    const narrative = parseNarrative(result.text);

    if (narrative === null) {
      this.logger.warn(`Briefing narrative for ${userId} could not be read`);
      return null;
    }

    await this.redis.client
      .set(key, narrative, 'EX', NARRATIVE_TTL_SECONDS)
      .catch((error: unknown) => {
        this.logger.warn(`Could not cache the briefing narrative: ${String(error)}`);
      });

    return narrative;
  }
}

/** Enough to tell one set of numbers from another; not a security boundary. */
function hash(value: string): string {
  let digest = 0;

  for (let index = 0; index < value.length; index += 1) {
    digest = (digest * 31 + value.charCodeAt(index)) | 0;
  }

  return (digest >>> 0).toString(36);
}
