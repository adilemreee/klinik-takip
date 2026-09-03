import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { ProtocolDocumentDto, ProtocolSummaryDto, UploadProtocolDto } from './dto/protocol.dto';
import { ProtocolsService, type DocumentSummary } from './protocols.service';
import type { ProtocolDocument } from '@prisma/client';

/**
 * The corpus the assistant is allowed to answer from (spec M4).
 *
 * Managed by the clinic rather than assembled from anywhere else: the whole
 * value of "the bot answers only from these" is that somebody clinical decided
 * what "these" are.
 */
@ApiTags('protocols')
@ApiBearerAuth()
@Controller('protocols')
export class ProtocolsController {
  constructor(private readonly protocols: ProtocolsService) {}

  @Post()
  @RequirePermissions('ai.protocols.manage')
  @ApiOperation({ summary: 'Add a protocol or FAQ document to the assistant corpus' })
  @ApiCreatedResponse({ type: ProtocolSummaryDto })
  @ApiStandardErrors()
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadProtocolDto,
  ): Promise<DocumentSummary> {
    return this.protocols.upload(user, dto);
  }

  @Get()
  @RequirePermissions('ai.protocols.manage')
  @ApiOperation({ summary: 'The documents the assistant can quote' })
  @ApiOkResponse({ type: [ProtocolSummaryDto] })
  @ApiStandardErrors()
  async list(@Query('includeInactive') includeInactive?: string): Promise<DocumentSummary[]> {
    return this.protocols.list(includeInactive !== 'true');
  }

  /**
   * Retired rather than deleted: an answer the assistant gave last month cited
   * a passage, and a clinic reviewing what the bot said needs to read what it
   * was reading.
   */
  @Delete(':documentId')
  @RequirePermissions('ai.protocols.manage')
  @ApiOperation({ summary: 'Retire a document, so the assistant stops quoting it' })
  @ApiOkResponse({ type: ProtocolDocumentDto })
  @ApiStandardErrors()
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<ProtocolDocument> {
    return this.protocols.deactivate(user, documentId);
  }
}
