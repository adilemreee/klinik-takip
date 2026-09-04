import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  Prisma,
  SurveyStatus,
  type SurveyAssignment,
  type SurveyTemplate,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CareTeamService } from '../authz/care-team.service';
import { PatientAccessService } from '../authz/patient-access.service';
import { addDays, instantAt, localDate } from '../common/local-calendar';
import { PrismaService } from '../infra/prisma.service';
import { MeasurementsService } from '../measurements/measurements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/templates';
import {
  compare,
  invitesReview,
  isPartial,
  score,
  type Finding,
} from './scoring';
import { parseQuestions, validateAnswers, type SurveyQuestion } from './survey';
import { SATISFACTION_QUESTION, STARTER_TEMPLATES } from './survey-templates';

/**
 * Patient-reported outcome questionnaires (spec M18, T6.7).
 *
 * The module's whole job is to turn a handful of numbers a patient typed into
 * something a clinician can act on without being buried. Three decisions carry
 * that:
 *
 * **A worsening trend pages a person; it never does anything on its own.** The
 * same rule as everywhere else in this system — the software says "look at
 * this", and a human decides what it means.
 *
 * **It pages the assigned team, not the clinic.** The lesson from the
 * medication warning: an alert that goes to everybody is an alert that belongs
 * to nobody.
 *
 * **A late answer is not an answer.** A pain score given three weeks after the
 * week it was about is a memory, and putting it on the chart at the milestone
 * it was scheduled for would be recording something that did not happen.
 */

/** How long a patient has to answer before the questionnaire lapses. */
export const RESPONSE_WINDOW_DAYS = 14;

/** The clinic's hour for asking. Nobody wants a survey at three in the morning. */
const ASK_AT_HOUR = 11;

export interface SurveySeriesPoint {
  assignmentId: string;
  milestoneDays: number;
  submittedAt: Date;
  values: Record<string, number>;
  answeredCount: number;
  questionCount: number;
  /** True when too little was answered to sit beside a full response. */
  partial: boolean;
}

export interface PatientSurveyView {
  template: { code: string; version: number; title: string; questions: SurveyQuestion[] };
  series: SurveySeriesPoint[];
  /** From the most recent response only. */
  latestFindings: Finding[];
  /** False while there is only one response: a line needs two points. */
  hasTrend: boolean;
  pending: SurveyAssignment[];
}

@Injectable()
export class SurveysService {
  private readonly logger = new Logger(SurveysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PatientAccessService,
    private readonly measurements: MeasurementsService,
    private readonly careTeam: CareTeamService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Writes the starter questionnaire if that version is not already there.
   *
   * Never updates one in place: a template version is frozen once anybody has
   * answered it, and editing the questions under a stored score is how a trend
   * line moves because somebody fixed a typo.
   */
  async ensureStarterTemplates(): Promise<number> {
    let created = 0;

    for (const definition of STARTER_TEMPLATES) {
      const existing = await this.prisma.surveyTemplate.findUnique({
        where: { code_version: { code: definition.code, version: definition.version } },
      });

      if (existing) continue;

      await this.prisma.surveyTemplate.create({
        data: {
          code: definition.code,
          version: definition.version,
          title: definition.title,
          description: definition.description,
          questions: definition.questions as unknown as Prisma.InputJsonValue,
          milestoneDays: definition.milestoneDays,
        },
      });

      created += 1;
    }

    if (created > 0) this.logger.log(`Seeded ${created} survey template(s)`);

    return created;
  }

  /** The newest active version of a questionnaire. */
  async currentTemplate(code: string): Promise<SurveyTemplate> {
    const template = await this.prisma.surveyTemplate.findFirst({
      where: { code, isActive: true },
      orderBy: { version: 'desc' },
    });

    if (!template) throw new NotFoundException(`No active survey template: ${code}`);

    return template;
  }

  /**
   * Puts the milestones in the patient's diary after an operation.
   *
   * Safe to call again, and it has to be: an operation gets postponed, and a
   * questionnaire still asking about "one week after" from the old date would
   * arrive before the surgery. So an unanswered milestone **moves** with the
   * date, and one the patient has already answered is left exactly where it is
   * — regenerating over a completed response would throw away what they said.
   */
  async scheduleForSurgery(
    patientId: string,
    surgeryId: string | null,
    performedAt: Date,
    code = 'postop',
    timezone = 'Europe/Istanbul',
  ): Promise<{ created: number; moved: number; kept: number }> {
    const template = await this.currentTemplate(code);
    const operationDay = localDate(performedAt, timezone);

    let created = 0;
    let moved = 0;
    let kept = 0;

    for (const days of template.milestoneDays) {
      const due = instantAt(addDays(operationDay, days), ASK_AT_HOUR, timezone);
      const expires = new Date(due.getTime() + RESPONSE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

      const existing = await this.prisma.surveyAssignment.findUnique({
        where: {
          patientId_templateId_milestoneDays: {
            patientId,
            templateId: template.id,
            milestoneDays: days,
          },
        },
        include: { response: { select: { id: true } } },
      });

      if (!existing) {
        await this.prisma.surveyAssignment.create({
          data: {
            patientId,
            templateId: template.id,
            surgeryId,
            milestoneDays: days,
            scheduledFor: due,
            expiresAt: expires,
          },
        });
        created += 1;
        continue;
      }

      // Answered milestones are the patient's record of that week. Nothing
      // moves them.
      if (existing.response) {
        kept += 1;
        continue;
      }

      if (existing.scheduledFor.getTime() === due.getTime()) continue;

      await this.prisma.surveyAssignment.update({
        where: { id: existing.id },
        data: {
          surgeryId,
          scheduledFor: due,
          expiresAt: expires,
          // Back to pending: it was asked about a week that has moved, so the
          // sweep should ask again at the new time.
          status: SurveyStatus.PENDING,
          sentAt: null,
        },
      });
      moved += 1;
    }

    if (created > 0 || moved > 0) {
      this.logger.log(
        `Questionnaires for patient ${patientId}: ${created} scheduled, ${moved} moved, ${kept} kept`,
      );
    }

    return { created, moved, kept };
  }

  /** What this patient has been asked and has not answered. */
  async mine(user: AuthenticatedUser): Promise<{
    assignment: SurveyAssignment;
    template: { code: string; version: number; title: string; description: string | null; questions: SurveyQuestion[] };
  }[]> {
    const patientId = await this.measurements.ownPatientId(user);
    const now = new Date();

    const assignments = await this.prisma.surveyAssignment.findMany({
      where: {
        patientId,
        status: { in: [SurveyStatus.PENDING, SurveyStatus.SENT] },
        scheduledFor: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: { template: true },
      orderBy: { scheduledFor: 'asc' },
    });

    return assignments.map((assignment) => ({
      assignment,
      template: {
        code: assignment.template.code,
        version: assignment.template.version,
        title: assignment.template.title,
        description: assignment.template.description,
        questions: parseQuestions(assignment.template.questions),
      },
    }));
  }

  /**
   * A patient's answers.
   *
   * Everything that can go wrong with the submission is decided before
   * anything is written: an answer that does not fit its question, a
   * questionnaire that has already been answered, one whose window has closed.
   */
  async submit(
    user: AuthenticatedUser,
    assignmentId: string,
    submitted: Record<string, unknown>,
    now = new Date(),
  ): Promise<{ findings: Finding[]; invited: boolean }> {
    const patientId = await this.measurements.ownPatientId(user);

    const assignment = await this.prisma.surveyAssignment.findFirst({
      where: { id: assignmentId, patientId },
      include: { template: true, response: true },
    });

    if (!assignment) throw new NotFoundException('Survey not found');
    if (assignment.response) throw new ConflictException('This survey has already been answered');

    if (assignment.expiresAt && assignment.expiresAt < now) {
      // Refused rather than accepted late. A pain score given three weeks after
      // the week it was about is a memory, and filing it at that milestone
      // would record something that did not happen.
      throw new BadRequestException('This survey is no longer open');
    }

    const questions = parseQuestions(assignment.template.questions);

    let validated;
    try {
      validated = validateAnswers(questions, submitted);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : String(error));
    }

    const scored = score(questions, validated.answers);
    const previous = await this.previousValues(patientId, assignment.template.code, now);
    const trend = compare(questions, scored.values, previous);

    await this.prisma.$transaction(async (tx) => {
      await tx.surveyResponse.create({
        data: {
          assignmentId,
          patientId,
          templateCode: assignment.template.code,
          templateVersion: assignment.template.version,
          answers: validated.answers,
          scores: scored.values,
          answeredCount: scored.answeredCount,
          questionCount: scored.questionCount,
          submittedAt: now,
        },
      });

      await tx.surveyAssignment.update({
        where: { id: assignmentId },
        data: { status: SurveyStatus.COMPLETED },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.CREATE,
        entityType: 'survey_responses',
        entityId: assignmentId,
        patientId,
        after: {
          milestoneDays: assignment.milestoneDays,
          answered: `${scored.answeredCount}/${scored.questionCount}`,
          findings: trend.findings.map((finding) => finding.kind),
        },
      });
    });

    if (trend.findings.length > 0) {
      await this.alertCareTeam(patientId, trend.findings, assignment.milestoneDays);
    }

    const satisfaction = scored.values[SATISFACTION_QUESTION];
    const invited = invitesReview(satisfaction);

    if (invited) {
      await this.notifications.dispatch({
        userId: user.id,
        type: NOTIFICATION_TYPES.surveyReviewInvite,
        data: { assignmentId },
      });
    }

    return { findings: trend.findings, invited };
  }

  /** The series a clinician's chart is drawn from. */
  async forPatient(
    user: AuthenticatedUser,
    patientId: string,
    code = 'postop',
  ): Promise<PatientSurveyView> {
    await this.access.assertCanAccess(user, patientId);

    const template = await this.currentTemplate(code);
    const questions = parseQuestions(template.questions);

    const responses = await this.prisma.surveyResponse.findMany({
      where: { patientId, templateCode: code },
      include: { assignment: { select: { milestoneDays: true } } },
      orderBy: { submittedAt: 'asc' },
    });

    const series: SurveySeriesPoint[] = responses.map((response) => {
      const values = response.scores as Record<string, number>;

      return {
        assignmentId: response.assignmentId,
        milestoneDays: response.assignment.milestoneDays,
        submittedAt: response.submittedAt,
        values,
        answeredCount: response.answeredCount,
        questionCount: response.questionCount,
        partial: isPartial({
          values,
          answeredCount: response.answeredCount,
          questionCount: response.questionCount,
          completeness:
            response.questionCount === 0
              ? 0
              : response.answeredCount / response.questionCount,
        }),
      };
    });

    const latest = series[series.length - 1];
    const before = series[series.length - 2];

    return {
      template: {
        code: template.code,
        version: template.version,
        title: template.title,
        questions,
      },
      series,
      latestFindings: latest
        ? compare(questions, latest.values, before?.values ?? null).findings
        : [],
      // A line needs two points; one response is a reading, not a trend.
      hasTrend: series.length >= 2,
      pending: await this.prisma.surveyAssignment.findMany({
        where: {
          patientId,
          templateId: template.id,
          status: { in: [SurveyStatus.PENDING, SurveyStatus.SENT] },
        },
        orderBy: { scheduledFor: 'asc' },
      }),
    };
  }

  // --------------------------------------------------------------- internals

  /** The last set of numeric answers before now, or null for a first response. */
  private async previousValues(
    patientId: string,
    code: string,
    now: Date,
  ): Promise<Record<string, number> | null> {
    const previous = await this.prisma.surveyResponse.findFirst({
      where: { patientId, templateCode: code, submittedAt: { lt: now } },
      orderBy: { submittedAt: 'desc' },
    });

    return previous ? (previous.scores as Record<string, number>) : null;
  }

  /**
   * Tells the people looking after this patient.
   *
   * `assigned`, not `everyone`: an unassigned patient's questionnaire must not
   * page the whole clinic, which is the mistake the medication warning made
   * before a test caught it.
   */
  private async alertCareTeam(
    patientId: string,
    findings: Finding[],
    milestoneDays: number,
  ): Promise<void> {
    const staff = await this.careTeam.assigned(patientId);

    if (staff.length === 0) {
      this.logger.warn(`No assigned staff for patient ${patientId}; survey finding not delivered`);
      return;
    }

    for (const userId of staff) {
      await this.notifications.dispatch({
        userId,
        type: NOTIFICATION_TYPES.surveyWorsening,
        data: {
          patientId,
          milestoneDays,
          findings: findings.map((finding) => ({
            kind: finding.kind,
            question: finding.questionText,
            value: finding.value,
            previous: finding.previous,
          })),
        },
      });
    }
  }
}
