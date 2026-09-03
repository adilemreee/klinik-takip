import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Export } from '@prisma/client';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { DownloadLinkDto, ExportResponseDto, RequestSummaryDto } from './dto/exports.dto';
import { ExportsService } from './exports.service';

/**
 * Files that leave the building (spec M12, T6.5).
 *
 * An export is a request rather than a download: it is produced on the queue, a
 * notification says when it is ready, and the link handed out afterwards is
 * short-lived and signed. Both the finishing and the download are audited —
 * "who took what data out, and when" is the question this module exists to be
 * able to answer.
 */
@ApiTags('exports')
@ApiBearerAuth()
@Controller()
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Post('patients/:id/exports/summary')
  @RequirePermissions('export.create')
  @ApiOperation({ summary: 'Ask for a patient summary PDF' })
  @ApiCreatedResponse({ type: ExportResponseDto })
  @ApiStandardErrors()
  async requestSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Body() dto: RequestSummaryDto,
  ): Promise<Export> {
    return this.exports.requestPatientSummary(user, patientId, {
      includePhotos: dto.includePhotos === true,
    });
  }

  @Get('exports')
  @RequirePermissions('export.create')
  @ApiOperation({ summary: 'Exports you asked for' })
  @ApiOkResponse({ type: [ExportResponseDto] })
  @ApiStandardErrors()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<Export[]> {
    return this.exports.list(user);
  }

  @Get('exports/:id')
  @RequirePermissions('export.create')
  @ApiOperation({ summary: 'Whether it is ready, and what went into it' })
  @ApiOkResponse({ type: ExportResponseDto })
  @ApiStandardErrors()
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Export> {
    return this.exports.get(user, id);
  }

  @Post('exports/:id/download')
  @RequirePermissions('export.create')
  @ApiOperation({
    summary: 'A short-lived signed link. Audited: this is the moment the data can leave',
  })
  @ApiCreatedResponse({ type: DownloadLinkDto })
  @ApiStandardErrors()
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ url: string; expiresAt: Date; filename: string }> {
    return this.exports.download(user, id);
  }
}
