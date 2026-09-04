import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { IdentityDto, PatientHomeSummaryDto } from './dto/me-response.dto';
import { MeService, type Identity, type PatientHomeSummary } from './me.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

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
