import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import {
  AssignmentDto,
  PatientDto,
  PatientPageDto,
} from './dto/patient-response.dto';
import { AuditAction, Patient } from '@prisma/client';
import type { Request } from 'express';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import {
  AssignStaffDto,
  CreatePatientDto,
  MedicalProfileDto,
  SearchPatientsDto,
  UpdatePatientDto,
} from './dto/patient.dto';
import {
  AssignmentSummary,
  PatientPage,
  PatientsService,
  RequestContext,
} from './patients.service';

@ApiTags('patients')
@ApiBearerAuth()
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Post()
  @RequirePermissions('patients.write')
  @ApiOperation({ summary: 'Create a patient file; the file number is allocated here' })
  @ApiCreatedResponse({ type: PatientDto })
  @ApiStandardErrors({ notFound: false })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePatientDto,
    @Req() request: Request,
  ): Promise<Patient> {
    return this.patients.create(user, dto, this.context(request));
  }

  @Get()
  @RequirePermissions('patients.read')
  // Listing is a view of patient data, so it is recorded like any other read
  // (spec section 13).
  @Audit({ entityType: 'patients', action: AuditAction.READ })
  @ApiOperation({ summary: 'Search within the caller’s scope' })
  @ApiOkResponse({ type: PatientPageDto })
  @ApiStandardErrors({ notFound: false })
  async search(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: SearchPatientsDto,
  ): Promise<PatientPage> {
    return this.patients.search(user, dto);
  }

  @Get(':id')
  @RequirePermissions('patients.read')
  @Audit({ entityType: 'patients', action: AuditAction.READ, entityIdParam: 'id' })
  @ApiOperation({ summary: 'One patient file' })
  @ApiOkResponse({ type: PatientDto })
  @ApiStandardErrors()
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Patient> {
    return this.patients.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('patients.write')
  @ApiOperation({ summary: 'Update demographics and status' })
  @ApiOkResponse({ type: PatientDto })
  @ApiStandardErrors()
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientDto,
    @Req() request: Request,
  ): Promise<Patient> {
    // The version travels in the body rather than a header so it survives
    // every generated client and shows up in the schema.
    const { expectedVersion, ...changes } = dto;

    return this.patients.update(user, id, changes, this.context(request), expectedVersion);
  }

  @Put(':id/medical-profile')
  @RequirePermissions('medical.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Allergies, chronic conditions, smoking and alcohol' })
  @ApiNoContentResponse({ description: 'Stored' })
  @ApiStandardErrors()
  async upsertMedicalProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MedicalProfileDto,
    @Req() request: Request,
  ): Promise<void> {
    const { expectedVersion, ...changes } = dto;

    await this.patients.upsertMedicalProfile(
      user,
      id,
      changes,
      this.context(request),
      expectedVersion,
    );
  }

  @Get(':id/assignments')
  @RequirePermissions('patients.read')
  @Audit({ entityType: 'patient_assignments', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: 'Staff currently assigned to this patient' })
  @ApiOkResponse({ type: [AssignmentDto] })
  @ApiStandardErrors()
  async listAssignments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AssignmentSummary[]> {
    return this.patients.listAssignments(user, id);
  }

  @Post(':id/assignments')
  @RequirePermissions('patients.assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Assign a staff member — this decides who can see the file' })
  @ApiNoContentResponse({ description: 'Assigned' })
  @ApiStandardErrors()
  async assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignStaffDto,
    @Req() request: Request,
  ): Promise<void> {
    await this.patients.assignStaff(user, id, dto, this.context(request));
  }

  @Delete(':id/assignments/:staffId')
  @RequirePermissions('patients.assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End an assignment' })
  @ApiNoContentResponse({ description: 'Assignment ended' })
  @ApiStandardErrors()
  async unassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.patients.unassignStaff(user, id, staffId, this.context(request));
  }

  @Delete(':id')
  @RequirePermissions('patients.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a file — soft delete; records are retained by law' })
  @ApiNoContentResponse({ description: 'Deactivated' })
  @ApiStandardErrors()
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.patients.softDelete(user, id, this.context(request));
  }

  private context(request: Request): RequestContext {
    return {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: typeof request.id === 'string' ? request.id : undefined,
    };
  }
}
