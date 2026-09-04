import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequireAnyPermission } from '../authz/decorators/require-permissions.decorator';
import { MeasurementsService } from '../measurements/measurements.service';
import { DataExportDto } from './dto/portability.dto';
import { PortabilityService } from './portability.service';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { IdentityDto, PatientHomeSummaryDto } from './dto/me-response.dto';
import { MeService, type Identity, type PatientHomeSummary } from './me.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly measurements: MeasurementsService,
    private readonly portability: PortabilityService,
  ) {}

  /**
   * Everything the clinic holds about the caller, as structured data (KVKK m.11).
   *
   * JSON rather than a rendered document: the right is to *receive the data*,
   * and a PDF is not portable in the sense the law means. The patient summary
   * PDF already exists for reading.
   */
  @Get('data-export')
  @RequireAnyPermission('self.read')
  @ApiOperation({ summary: 'Your own data, in a form you can take elsewhere' })
  @ApiOkResponse({ type: DataExportDto })
  @ApiStandardErrors()
  async dataExport(@CurrentUser() user: AuthenticatedUser): Promise<DataExportDto> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.portability.exportFor(patientId);
  }

  /**
   * Who is signed in.
   *
   * No permission required, on purpose: this is the question a client has to
   * answer before it knows what else it may ask, and it returns nothing about
   * anybody but the caller.
   */
  @Get('identity')
  @ApiOperation({ summary: 'The signed-in account: role, name and patient file if any' })
  @ApiOkResponse({ type: IdentityDto })
  @ApiStandardErrors()
  async identity(@CurrentUser() user: AuthenticatedUser): Promise<Identity> {
    return this.me.identity(user);
  }

  @Get('summary')
  @RequirePermissions('self.read')
  @Audit({ entityType: 'patients', action: AuditAction.READ })
  @ApiOperation({ summary: 'Everything the patient home screen needs, in one call' })
  @ApiOkResponse({ type: PatientHomeSummaryDto })
  @ApiStandardErrors()
  async summary(@CurrentUser() user: AuthenticatedUser): Promise<PatientHomeSummary> {
    return this.me.summary(user);
  }
}
