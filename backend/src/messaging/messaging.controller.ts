import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Conversation, QuickReply } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { firstFilePart } from '../documents/multipart';
import { MeasurementsService } from '../measurements/measurements.service';
import {
  AttachmentDto,
  AttachmentUrlDto,
  ClinicStateDto,
  ConversationDto,
  CreateQuickReplyDto,
  MessagePageDto,
  MessagePageQueryDto,
  QuickReplyDto,
  SendMessageDto,
  SentMessageDto,
} from './dto/message.dto';
import { MessagePage, MessagingService, SentMessage } from './messaging.service';

@ApiTags('messaging')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly messaging: MessagingService) {}

  /**
   * Whether the clinic is reachable now.
   *
   * Its own endpoint so the compose box can say "queued until 18:00" before
   * the patient writes, rather than after they have sent something.
   */
  @Get('clinic-state')
  @RequireAnyPermission('messages.read', 'self.message')
  @ApiOperation({ summary: 'Whether the clinic is inside its access window' })
  @ApiOkResponse({ type: ClinicStateDto })
  @ApiStandardErrors()
  async clinicState(): Promise<ClinicStateDto> {
    return this.messaging.clinicState();
  }

  @Get()
  @RequirePermissions('messages.read')
  @ApiOperation({ summary: 'Conversations to look at, most recent first' })
  @ApiOkResponse({ type: [ConversationDto] })
  @ApiStandardErrors()
  async inbox(@CurrentUser() user: AuthenticatedUser): Promise<Conversation[]> {
    return this.messaging.inbox(user);
  }

  @Get(':conversationId/messages')
  @RequireAnyPermission('messages.read', 'self.message')
  @ApiOperation({ summary: 'Messages, oldest first; the cursor walks backwards' })
  @ApiOkResponse({ type: MessagePageDto })
  @ApiStandardErrors()
  async messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: MessagePageQueryDto,
  ): Promise<MessagePage> {
    return this.messaging.messages(user, conversationId, query);
  }

  @Post(':conversationId/messages')
  @RequireAnyPermission('messages.write', 'self.message')
  @ApiOperation({ summary: 'Send a message; a patient outside the window is queued' })
  @ApiCreatedResponse({ type: SentMessageDto })
  @ApiStandardErrors()
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: SendMessageDto,
  ): Promise<SentMessage> {
    return this.messaging.send(user, conversationId, dto);
  }

  @Post(':conversationId/attachments')
  @RequireAnyPermission('messages.write', 'self.message')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an attachment, then send its key with a message' })
  @ApiCreatedResponse({ type: AttachmentDto })
  @ApiStandardErrors()
  async attach(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Req() request: Request,
  ): Promise<AttachmentDto> {
    const part = await firstFilePart(request, 64 * 1024 * 1024);

    return this.messaging.uploadAttachment(user, conversationId, part.stream, part.filename);
  }

  @Post(':conversationId/read')
  @HttpCode(200)
  @RequireAnyPermission('messages.read', 'self.message')
  @ApiOperation({ summary: 'Mark everything the caller did not send as read' })
  @ApiOkResponse({ schema: { properties: { marked: { type: 'number' } } } })
  @ApiStandardErrors()
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<{ marked: number }> {
    return { marked: await this.messaging.markRead(user, conversationId) };
  }

  @Get('messages/:messageId/attachment')
  @RequireAnyPermission('messages.read', 'self.message')
  @ApiOperation({ summary: 'A short-lived signed URL for an attachment' })
  @ApiOkResponse({ type: AttachmentUrlDto })
  @ApiStandardErrors()
  async attachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<AttachmentUrlDto> {
    return this.messaging.attachmentUrl(user, messageId);
  }
}

@ApiTags('messaging')
@ApiBearerAuth()
@Controller('quick-replies')
export class QuickRepliesController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  @RequirePermissions('messages.write')
  @ApiOperation({ summary: "The clinic's shared replies and the caller's own" })
  @ApiOkResponse({ type: [QuickReplyDto] })
  @ApiStandardErrors()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<QuickReply[]> {
    return this.messaging.quickReplies(user);
  }

  @Post()
  @RequirePermissions('messages.write')
  @ApiOperation({ summary: 'Save a reply of your own' })
  @ApiCreatedResponse({ type: QuickReplyDto })
  @ApiStandardErrors()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateQuickReplyDto,
  ): Promise<QuickReply> {
    return this.messaging.createQuickReply(user, dto);
  }

  @Delete(':quickReplyId')
  @HttpCode(204)
  @RequirePermissions('messages.write')
  @ApiOperation({ summary: 'Retire one of your own replies' })
  @ApiNoContentResponse()
  @ApiStandardErrors()
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('quickReplyId', ParseUUIDPipe) quickReplyId: string,
  ): Promise<void> {
    return this.messaging.removeQuickReply(user, quickReplyId);
  }
}

@ApiTags('messaging')
@ApiBearerAuth()
@Controller('patients/:id/conversation')
export class PatientConversationController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  @RequirePermissions('messages.read')
  @ApiOperation({ summary: "The patient's conversation, created on first use" })
  @ApiOkResponse({ type: ConversationDto })
  @ApiStandardErrors()
  async conversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
  ): Promise<Conversation> {
    return this.messaging.conversationFor(user, patientId);
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me/conversation')
export class MyConversationController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly measurements: MeasurementsService,
  ) {}

  @Get()
  @RequirePermissions('self.message')
  @ApiOperation({ summary: 'Your conversation with the clinic' })
  @ApiOkResponse({ type: ConversationDto })
  @ApiStandardErrors()
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<Conversation> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.messaging.conversationFor(user, patientId);
  }
}
