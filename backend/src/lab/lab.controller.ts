import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction, LabResult } from '@prisma/client';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { LabResultDto, ReviewItemDto, VerifyLabResultDto } from './dto/lab.dto';
import { LabService, ReviewItem } from './lab.service';

@ApiTags('lab')
@ApiBearerAuth()
@Controller('patients/:id/lab-results')
export class PatientLabController {
  constructor(private readonly lab: LabService) {}

  /**
   * What OCR read and nobody has confirmed yet.
   *
   * Requires medical.write, not medical.read: this is the queue where a value
   * becomes clinical, and reading it is the first half of an action.
   */
  @Get('pending')
  @RequirePermissions('medical.write')
  @Audit({ entityType: 'lab_results', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: 'Results waiting for a human, least certain first' })
  @ApiOkResponse({ type: [ReviewItemDto] })
  @ApiStandardErrors()
  async pending(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
  ): Promise<ReviewItem[]> {
    return this.lab.pendingReview(user, patientId);
  }

  @Get()
  @RequirePermissions('medical.read')
  @Audit({ entityType: 'lab_results', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: 'Confirmed results only — what a trend may be drawn from' })
  @ApiOkResponse({ type: [LabResultDto] })
  @ApiStandardErrors()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Query('analyteCode') analyteCode?: string,
  ): Promise<LabResult[]> {
    return this.lab.verified(user, patientId, analyteCode);
  }
}

@ApiTags('lab')
@ApiBearerAuth()
@Controller('lab-results')
export class LabResultsController {
  constructor(private readonly lab: LabService) {}

  @Patch(':resultId/verify')
  @RequirePermissions('medical.write')
  @ApiOperation({ summary: 'Confirm a result, with corrections' })
  @ApiOkResponse({ type: LabResultDto })
  @ApiStandardErrors()
  async verify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('resultId', ParseUUIDPipe) resultId: string,
    @Body() dto: VerifyLabResultDto,
  ): Promise<LabResult> {
    return this.lab.verify(user, resultId, dto);
  }

  @Delete(':resultId')
  @HttpCode(204)
  @RequirePermissions('medical.write')
  @ApiOperation({ summary: 'Discard something OCR read that is not a result' })
  @ApiNoContentResponse()
  @ApiStandardErrors()
  async discard(
    @CurrentUser() user: AuthenticatedUser,
    @Param('resultId', ParseUUIDPipe) resultId: string,
  ): Promise<void> {
    return this.lab.discard(user, resultId);
  }
}
