import { Body, Controller, Delete, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { AiSettingsService, type AiSettingsView } from './ai-settings.service';
import { AIService, type UsageReport } from './ai.service';
import {
  AiConnectionTestDto,
  AiProviderInfoDto,
  AiSettingsDto,
  AIUsageDto,
  UpdateAiSettingsDto,
} from './dto/ai.dto';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AIController {
  constructor(
    private readonly ai: AIService,
    private readonly settings: AiSettingsService,
  ) {}

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

  /**
   * The four services a clinic can choose between, with where to get a key and
   * what to check about each one's data handling.
   *
   * Served rather than hard-coded in the app so a settings screen cannot drift
   * from what the server will actually accept.
   */
  @Get('providers')
  @RequirePermissions('permissions.manage')
  @ApiOperation({ summary: 'Selectable AI providers, their models and their retention terms' })
  @ApiOkResponse({ type: [AiProviderInfoDto] })
  @ApiStandardErrors()
  providers(): AiProviderInfoDto[] {
    return Object.values(this.settings.catalogue());
  }

  /** What is configured. Never the key. */
  @Get('settings')
  @RequirePermissions('permissions.manage')
  @ApiOperation({ summary: 'The AI configuration, with the key redacted to its last four' })
  @ApiOkResponse({ type: AiSettingsDto })
  @ApiStandardErrors()
  async settingsView(): Promise<AiSettingsView> {
    return this.settings.view();
  }

  /**
   * Choose the provider, enter the key, set the price.
   *
   * `permissions.manage`, which only SUPER_ADMIN holds by default: this
   * decides where patient-adjacent text is sent and what it costs.
   */
  @Put('settings')
  @RequirePermissions('permissions.manage')
  @ApiOperation({ summary: 'Set the provider, model, key, price and retention declaration' })
  @ApiOkResponse({ type: AiSettingsDto })
  @ApiStandardErrors()
  async updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAiSettingsDto,
  ): Promise<AiSettingsView> {
    const view = await this.settings.update(user, dto);

    // Applied immediately: a clinic that just entered a key expects the next
    // request to use it, not the next deployment.
    await this.ai.reload();

    return view;
  }

  /** Turns the AI layer off by forgetting the configuration. */
  @Delete('settings')
  @RequirePermissions('permissions.manage')
  @ApiOperation({ summary: 'Clear the configuration, which switches the AI layer off' })
  @ApiOkResponse({ type: AiSettingsDto })
  @ApiStandardErrors()
  async clearSettings(@CurrentUser() user: AuthenticatedUser): Promise<AiSettingsView> {
    const view = await this.settings.clear(user);
    await this.ai.reload();

    return view;
  }

  /**
   * Sends the provider a trivial prompt to see whether the key works.
   *
   * Worth an endpoint because the alternative is finding out from a clinician
   * whose lab summary failed. Nothing clinical is sent, so this works before
   * the zero-retention declaration is made.
   */
  @Post('settings/test')
  @RequirePermissions('permissions.manage')
  @ApiOperation({ summary: 'Check the saved key against the provider' })
  @ApiOkResponse({ type: AiConnectionTestDto })
  @ApiStandardErrors()
  async testConnection(): Promise<AiConnectionTestDto> {
    return this.ai.testConnection();
  }
}
