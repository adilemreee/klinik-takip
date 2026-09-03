import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { MeasurementsService } from '../measurements/measurements.service';
import { AssistantService, type AssistantResult } from './assistant.service';
import { AskDto, AssistantResultDto } from './dto/assistant.dto';

@ApiTags('assistant')
@ApiBearerAuth()
@Controller('me/assistant')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly measurements: MeasurementsService,
  ) {}

  /**
   * The chatbot in front of the message box (spec M4).
   *
   * The question is recorded either way: a question the bot could not answer is
   * a message to the clinic, and every bot exchange has to be readable in the
   * doctor's panel.
   */
  @Post('ask')
  @RequirePermissions('self.message')
  @ApiOperation({ summary: 'Ask the FAQ assistant; it answers only from clinic documents' })
  @ApiCreatedResponse({ type: AssistantResultDto })
  @ApiStandardErrors()
  async ask(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AskDto,
  ): Promise<AssistantResult> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.assistant.ask(user, patientId, dto.question);
  }

  /** "This answer is not enough, send it to a doctor." */
  @Post(':messageId/escalate')
  @RequirePermissions('self.message')
  @ApiOperation({ summary: 'Hand a question the bot answered to a person' })
  @ApiNoContentResponse()
  @ApiStandardErrors()
  async escalate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<void> {
    return this.assistant.escalate(user, messageId);
  }
}
