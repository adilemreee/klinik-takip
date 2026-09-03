import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiJobType, AiReport, AuditAction, LabFlag, RiskLevel } from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { ageFrom } from '../ai/pseudonymise';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CareTeamService } from '../authz/care-team.service';
import { PatientAccessService } from '../authz/patient-access.service';
import { Env } from '../config/env.schema';
import { PrismaService } from '../infra/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/templates';
import {
  disclaimerFor,
  mayAutoRelease,
  parseInterpretation,
  renderPanel,
  selectResults,
  type PanelResult,
} from './lab-report';
import { SYSTEM_PROMPT, buildUserPrompt } from './lab-report.prompt';

/** `ai_reports.source` for everything this service produces. */
export const LAB_SOURCE = 'lab';

export interface ReportView {
  report: AiReport;
  /** The warning the specification puts under every AI output (M5). */
  disclaimer: string;
  /** True once a clinician has released it to the patient. */
  visibleToPatient: boolean;
}

/**
 * What the patient is given, which is a different document.
 *
 * Not the staff view with a field blanked out: the clinical rendering is
 * written for someone who can read hedged language as hedged, and it is not the
 * same text. The risk label is left out for the same reason — "CRITICAL" on a
 * patient's screen, with no clinician attached to it, is a verdict, and this
 * system is not allowed to hand out verdicts.
 */
export interface PatientReportView {
  id: string;
  source: string;
  /** The plain-language rendering. Never the clinical one. */
  contentMd: string;
  generatedAt: Date;
  releasedAt: Date;
  disclaimer: string;
}

@Injectable()
export class AIReportsService {
  private readonly logger = new Logger(AIReportsService.name);
  private readonly autoReleaseLowRisk: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly access: PatientAccessService,
    private readonly careTeam: CareTeamService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.autoReleaseLowRisk = config.get('AI_AUTO_RELEASE_LOW_RISK', { infer: true });
  }

  /**
   * Interprets a patient's verified lab results.
   *
   * Only verified ones. OCR output is not clinical until a human has confirmed
   * it (M16), and an interpretation of numbers nobody checked would be a
   * confident summary of a misread decimal point.
   */
  async interpretLabs(
    user: AuthenticatedUser,
    patientId: string,
    options: { documentId?: string } = {},
  ): Promise<ReportView> {
    await this.access.assertCanAccess(user, patientId);

    const results = await this.prisma.labResult.findMany({
      where: {
        patientId,
        verifiedAt: { not: null },
        ...(options.documentId ? { documentId: options.documentId } : {}),
      },
      orderBy: { measuredAt: 'desc' },
      take: 200,
    });

    if (results.length === 0) {
      throw new BadRequestException('There are no verified lab results to interpret');
    }

    const report = await this.generate(patientId, results.map(toPanelResult), user.id);

    if (report === null) {
      throw new BadRequestException('The AI layer could not produce an interpretation');
    }

    return this.view(report, patientId);
  }

  /**
   * The same thing without a user, for the queue.
   *
   * Returns null rather than throwing: a background job that cannot reach the
   * model has not failed at anything the clinic needs to be told about twice —
   * the results are on file and a clinician can ask for an interpretation.
   */
  async generate(
    patientId: string,
    results: PanelResult[],
    requestedById: string | null,
  ): Promise<AiReport | null> {
    if (results.length === 0) return null;

    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        mrn: true,
        birthDate: true,
        sex: true,
        preferredLanguage: true,
        user: { select: { phone: true, email: true } },
        surgeries: { orderBy: { performedAt: 'desc' }, take: 1 },
      },
    });

    if (!patient) return null;

    const selected = selectResults(results);
    const surgery = patient.surgeries[0] ?? null;

    const result = await this.ai.complete({
      purpose: AiJobType.LAB_INTERPRETATION,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserPrompt(renderPanel(selected), {
            age: ageFrom(patient.birthDate),
            sex: patient.sex,
            daysSinceSurgery: surgery
              ? Math.max(0, Math.floor((Date.now() - surgery.performedAt.getTime()) / 86_400_000))
              : null,
            procedureName: surgery?.procedureName ?? null,
          }),
        },
      ],
      containsHealthData: true,
      // The panel is analyte names and numbers, so there is nothing here to
      // scrub — which is exactly why the check still runs. It is cheap, and the
      // day somebody adds a free-text note to this prompt is the day it earns
      // its keep.
      identifiers: {
        names: [patient.firstName, patient.lastName],
        mrn: patient.mrn,
        phone: patient.user?.phone ?? null,
        email: patient.user?.email ?? null,
      },
      patientId,
      maxOutputTokens: 2_000,
      temperature: 0.2,
    });

    if (!result.ok) {
      this.logger.log(`No lab interpretation for patient ${patientId} (${result.reason})`);
      return null;
    }

    const interpretation = parseInterpretation(result.text);

    if (interpretation === null) {
      this.logger.warn(`Lab interpretation for ${patientId}: the model's answer could not be read`);
      return null;
    }

    /**
     * A truncated interpretation is not a shorter one.
     *
     * The clinical caveats sit at the end of a summary, so half of one reads as
     * more certain than the whole. It is refused rather than stored, because a
     * stored half is one a clinician can release.
     */
    if (result.truncated) {
      this.logger.warn(`Lab interpretation for ${patientId} was cut off; discarding it`);
      return null;
    }

    const autoRelease = mayAutoRelease(interpretation.riskLevel, this.autoReleaseLowRisk);
    const now = new Date();

    const report = await this.prisma.$transaction(async (tx) => {
      const created = await tx.aiReport.create({
        data: {
          patientId,
          source: LAB_SOURCE,
          contentMd: interpretation.doctorMd,
          patientFacingMd: interpretation.patientMd,
          riskLevel: interpretation.riskLevel,
          // What answered, not what was asked for (spec section 14.6).
          model: result.model,
          modelVersion: result.model,
          releasedToPatientAt: autoRelease ? now : null,
        },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: requestedById ?? undefined,
        action: AuditAction.CREATE,
        entityType: 'ai_reports',
        entityId: created.id,
        patientId,
        after: { id: created.id, riskLevel: created.riskLevel, source: created.source },
      });

      return created;
    });

    if (interpretation.riskLevel === RiskLevel.CRITICAL || interpretation.riskLevel === RiskLevel.HIGH) {
      await this.tellTheCareTeam(patientId, report.id).catch((error: unknown) => {
        this.logger.error(`Could not announce report ${report.id}: ${String(error)}`);
      });
    }

    return report;
  }

  /** A clinician's queue: reports nobody has looked at, oldest first. */
  async pending(user: AuthenticatedUser): Promise<ReportView[]> {
    const scope = await this.access.scopeFilter(user);

    const reports = await this.prisma.aiReport.findMany({
      where: { patient: scope, reviewedAt: null },
      orderBy: { generatedAt: 'asc' },
      take: 200,
      include: { patient: { select: { preferredLanguage: true } } },
    });

    return reports.map((report) => ({
      report,
      disclaimer: disclaimerFor(report.patient.preferredLanguage),
      visibleToPatient: report.releasedToPatientAt !== null,
    }));
  }

  async forPatient(user: AuthenticatedUser, patientId: string): Promise<ReportView[]> {
    await this.access.assertCanAccess(user, patientId);

    const reports = await this.prisma.aiReport.findMany({
      where: { patientId },
      orderBy: { generatedAt: 'desc' },
    });

    return Promise.all(reports.map((report) => this.view(report, patientId)));
  }

  /**
   * What the patient can see, which is only what somebody released.
   *
   * The filter is the rule from M5 made structural: there is no code path that
   * returns an unreleased report to a patient, so forgetting the check is not
   * something a later endpoint can do by omission — it would have to call a
   * different method.
   */
  async releasedTo(user: AuthenticatedUser, patientId: string): Promise<PatientReportView[]> {
    await this.access.assertCanAccess(user, patientId);

    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { preferredLanguage: true },
    });

    const reports = await this.prisma.aiReport.findMany({
      where: {
        patientId,
        releasedToPatientAt: { not: null },
        // A release with nothing written for the patient is not something to
        // render as an empty page.
        patientFacingMd: { not: null },
      },
      orderBy: { generatedAt: 'desc' },
      select: {
        id: true,
        source: true,
        patientFacingMd: true,
        generatedAt: true,
        releasedToPatientAt: true,
      },
    });

    return reports.map((report) => ({
      id: report.id,
      source: report.source,
      contentMd: report.patientFacingMd!,
      generatedAt: report.generatedAt,
      releasedAt: report.releasedToPatientAt!,
      disclaimer: disclaimerFor(patient?.preferredLanguage),
    }));
  }

  /**
   * A clinician signing off, and deciding whether the patient sees it.
   *
   * Reviewing and releasing are one action rather than two because they are one
   * decision: a doctor who has read the report knows whether it should go. Two
   * steps would leave a pile of reviewed-but-unreleased reports that nobody can
   * tell from unread ones.
   */
  async review(
    user: AuthenticatedUser,
    reportId: string,
    release: boolean,
  ): Promise<ReportView> {
    const existing = await this.findInScope(user, reportId);

    if (existing.reviewedAt) {
      throw new BadRequestException('This report has already been reviewed');
    }

    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.aiReport.update({
        where: { id: reportId },
        data: {
          reviewedById: user.id,
          reviewedAt: now,
          releasedToPatientAt: release ? (existing.releasedToPatientAt ?? now) : null,
        },
      });

      await this.audit.recordInTransaction(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.UPDATE,
        entityType: 'ai_reports',
        entityId: reportId,
        patientId: existing.patientId,
        before: existing,
        after: row,
      });

      return row;
    });

    return this.view(updated, updated.patientId);
  }

  private async tellTheCareTeam(patientId: string, reportId: string): Promise<void> {
    const recipients = await this.careTeam.everyone(patientId);
    const created = [];

    for (const userId of recipients) {
      const notification = await this.notifications.dispatch({
        userId,
        type: NOTIFICATION_TYPES.labCritical,
        data: { reportId, patientId },
      });

      if (notification) created.push(notification);
    }

    await this.notifications.deliverNow(created);
  }

  private async findInScope(user: AuthenticatedUser, reportId: string): Promise<AiReport> {
    const report = await this.prisma.aiReport.findUnique({ where: { id: reportId } });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    await this.access.assertCanAccess(user, report.patientId);

    return report;
  }

  private async view(report: AiReport, patientId: string): Promise<ReportView> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { preferredLanguage: true },
    });

    return {
      report,
      disclaimer: disclaimerFor(patient?.preferredLanguage),
      visibleToPatient: report.releasedToPatientAt !== null,
    };
  }
}

function toPanelResult(result: {
  analyteName: string;
  value: { toNumber(): number };
  unit: string;
  refLow: { toNumber(): number } | null;
  refHigh: { toNumber(): number } | null;
  flag: LabFlag | null;
  measuredAt: Date;
}): PanelResult {
  return {
    analyteName: result.analyteName,
    value: result.value.toNumber(),
    unit: result.unit,
    refLow: result.refLow?.toNumber() ?? null,
    refHigh: result.refHigh?.toNumber() ?? null,
    flag: result.flag,
    measuredAt: result.measuredAt,
  };
}
