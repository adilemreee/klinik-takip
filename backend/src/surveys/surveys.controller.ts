import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import {
  PatientSurveyViewDto,
  PendingSurveyDto,
  SubmitResultDto,
  SubmitSurveyDto,
} from './dto/survey.dto';
import { SurveysService, type PatientSurveyView } from './surveys.service';

/**
 * The patient's side of the questionnaires (spec M18, T6.7).
 *
 * A patient sees the questions and their own answers, and nothing else. In
 * particular they never see the findings their answers produced: "your
 * reported pain has worsened" is a clinical reading, and this module is not
 * the thing that should deliver one.
 */
@ApiTags('surveys')
@ApiBearerAuth()
@Controller('me/surveys')
export class MySurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get()
  @RequirePermissions('self.read')
  @ApiOperation({ summary: 'Questionnaires waiting for me' })
  @ApiOkResponse({ type: [PendingSurveyDto] })
  @ApiStandardErrors()
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<PendingSurveyDto[]> {
    const pending = await this.surveys.mine(user);

    return pending.map(({ assignment, template }) => ({
      id: assignment.id,
      title: template.title,
      description: template.description,
      milestoneDays: assignment.milestoneDays,
      scheduledFor: assignment.scheduledFor,
      expiresAt: assignment.expiresAt,
      questions: template.questions,
    }));
  }

  @Post(':id')
  @RequirePermissions('self.write')
  @ApiOperation({ summary: 'Answer one' })
  @ApiCreatedResponse({ type: SubmitResultDto })
  @ApiStandardErrors()
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) assignmentId: string,
    @Body() dto: SubmitSurveyDto,
  ): Promise<{ invited: boolean }> {
    const result = await this.surveys.submit(user, assignmentId, dto.answers);

    // The findings go to the care team, not back to the patient: "your pain
    // has worsened" is a clinical reading and this is not the thing that
    // should deliver one.
    return { invited: result.invited };
  }
}

/** The clinician's side: the series, and what the last response flagged. */
@ApiTags('surveys')
@ApiBearerAuth()
@Controller('patients/:id/surveys')
export class PatientSurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get()
  @RequirePermissions('medical.read')
  @Audit({ entityType: 'surveys', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: "A patient's reported outcomes over time" })
  @ApiOkResponse({ type: PatientSurveyViewDto })
  @ApiStandardErrors()
  async forPatient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
  ): Promise<PatientSurveyView> {
    return this.surveys.forPatient(user, patientId);
  }
}
