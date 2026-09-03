import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { AIService, type UsageReport } from './ai.service';
import { AIUsageDto } from './dto/ai.dto';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AIController {
  constructor(private readonly ai: AIService) {}

  /**
   * What the AI layer has cost this month (spec section 3.4).
   *
   * A panel rather than a log line because an unbounded AI spend on a clinic
   * budget is a real failure mode, and a number nobody can look at is a number
   * nobody checks until the invoice.
   */
  @Get('usage')
  @RequirePermissions('analytics.read')
  @ApiOperation({ summary: "This month's AI spend, tokens and refusals" })
  @ApiOkResponse({ type: AIUsageDto })
  @ApiStandardErrors()
  async usage(): Promise<UsageReport> {
    return this.ai.usage();
  }
}
