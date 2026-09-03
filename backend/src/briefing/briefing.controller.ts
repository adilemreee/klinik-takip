import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { BriefingService, type Briefing } from './briefing.service';
import { BriefingDto } from './dto/briefing.dto';

@ApiTags('briefing')
@ApiBearerAuth()
@Controller('me/briefing')
export class BriefingController {
  constructor(private readonly briefing: BriefingService) {}

  /**
   * "Yesterday, today, who is at risk" (spec M5).
   *
   * Computed on request rather than stored, because every number in it is a
   * fact about now: a briefing written at eight and read at eleven would be
   * three hours out of date about the one thing it is for.
   *
   * `medical.read` rather than an analytics permission — this is a clinical
   * worklist, and it is scoped to the caller's own patients like every other
   * clinical read.
   */
  @Get()
  @RequirePermissions('medical.read')
  @ApiOperation({ summary: 'Your morning briefing: yesterday, today, who is waiting' })
  @ApiOkResponse({ type: BriefingDto })
  @ApiStandardErrors()
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<Briefing> {
    return this.briefing.forUser(user);
  }
}
