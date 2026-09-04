import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Consent } from '@prisma/client';
import type { Request } from 'express';
import { AuditAction } from '@prisma/client';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { MeasurementsService } from '../measurements/measurements.service';
import { ConsentsService } from './consents.service';
import { ConsentDto, RecordConsentDto } from './dto/consent.dto';

const toDto = (consent: Consent): ConsentDto => ({
  id: consent.id,
  patientId: consent.patientId,
  type: consent.type,
  version: consent.version,
  signedAt: consent.signedAt,
  revokedAt: consent.revokedAt,
  active: consent.revokedAt === null,
});

/**
 * The patient's own consents.
 *
 * Giving and withdrawing both live here because withdrawal has to be as easy as
 * giving — a consent that can only be withdrawn by e-mailing the clinic is one
 * the clinic has made harder to take back than to give.
 */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me/consents')
export class MyConsentsController {
  constructor(
    private readonly consents: ConsentsService,
    private readonly measurements: MeasurementsService,
  ) {}

  @Get()
  @RequireAnyPermission('self.read')
  @ApiOperation({ summary: 'The consents you have given, including withdrawn ones' })
  @ApiOkResponse({ type: [ConsentDto] })
  @ApiStandardErrors()
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<ConsentDto[]> {
    const patientId = await this.measurements.ownPatientId(user);

    return (await this.consents.list(user, patientId)).map(toDto);
  }

  @Post()
  @RequireAnyPermission('self.write')
  @ApiOperation({ summary: 'Give a consent' })
  @ApiCreatedResponse({ type: ConsentDto })
  @ApiStandardErrors()
  async give(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordConsentDto,
    @Req() request: Request,
  ): Promise<ConsentDto> {
    const patientId = await this.measurements.ownPatientId(user);

    return toDto(
      await this.consents.record(user, patientId, {
        type: dto.type,
        version: dto.version,
        documentText: dto.documentText,
        // Recorded because proving a consent existed is the controller's
        // burden, and "somebody ticked a box" with no trace proves nothing.
        ipAddress: request.ip,
        userAgent: request.get('user-agent') ?? undefined,
      }),
    );
  }

  @Delete(':consentId')
  @RequireAnyPermission('self.write')
  @ApiOperation({ summary: 'Withdraw a consent; forward-only, the record is kept' })
  @ApiOkResponse({ type: ConsentDto })
  @ApiStandardErrors()
  async withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('consentId', ParseUUIDPipe) consentId: string,
  ): Promise<ConsentDto> {
    const patientId = await this.measurements.ownPatientId(user);

    return toDto(await this.consents.revoke(user, patientId, consentId));
  }
}

/** Staff reading and recording what a patient signed on paper. */
@ApiTags('consents')
@ApiBearerAuth()
@Controller('patients/:id/consents')
export class PatientConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  @Get()
  @RequirePermissions('patients.read')
  @Audit({ entityType: 'consents', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: "A patient's consents" })
  @ApiOkResponse({ type: [ConsentDto] })
  @ApiStandardErrors()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
  ): Promise<ConsentDto[]> {
    return (await this.consents.list(user, patientId)).map(toDto);
  }

  @Post()
  @RequirePermissions('patients.write')
  @Audit({ entityType: 'consents', action: AuditAction.CREATE, patientIdParam: 'id' })
  @ApiOperation({ summary: 'Record a consent the patient signed' })
  @ApiCreatedResponse({ type: ConsentDto })
  @ApiStandardErrors()
  async record(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Body() dto: RecordConsentDto,
    @Req() request: Request,
  ): Promise<ConsentDto> {
    return toDto(
      await this.consents.record(user, patientId, {
        type: dto.type,
        version: dto.version,
        documentText: dto.documentText,
        ipAddress: request.ip,
        userAgent: request.get('user-agent') ?? undefined,
      }),
    );
  }

  @Delete(':consentId')
  @RequirePermissions('patients.write')
  @Audit({ entityType: 'consents', action: AuditAction.UPDATE, patientIdParam: 'id' })
  @ApiOperation({ summary: 'Withdraw a consent on the patient\'s instruction' })
  @ApiOkResponse({ type: ConsentDto })
  @ApiStandardErrors()
  async withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Param('consentId', ParseUUIDPipe) consentId: string,
  ): Promise<ConsentDto> {
    return toDto(await this.consents.revoke(user, patientId, consentId));
  }
}
