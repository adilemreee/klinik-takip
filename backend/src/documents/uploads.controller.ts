import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { RequireAnyPermission } from '../authz/decorators/require-permissions.decorator';
import { MeasurementsService } from '../measurements/measurements.service';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import {
  BeginUploadDto,
  CompleteUploadDto,
  UploadedDocumentDto,
  UploadSessionDto,
} from './dto/document.dto';
import { ResumableUploadService } from './resumable-upload.service';

/**
 * Chunked, resumable upload (spec section 9).
 *
 * Three calls: open a session, send chunks at an offset, complete. A client
 * that lost its connection asks for the session and resumes from
 * `receivedBytes` — the only number the protocol turns on.
 */
@ApiTags('documents')
@ApiBearerAuth()
@Controller('patients/:id/documents/uploads')
export class BeginUploadController {
  constructor(private readonly uploads: ResumableUploadService) {}

  @Post()
  @RequirePermissions('documents.write')
  @ApiOperation({ summary: 'Open a resumable upload' })
  @ApiCreatedResponse({ type: UploadSessionDto })
  @ApiStandardErrors()
  async begin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Body() dto: BeginUploadDto,
  ): Promise<UploadSessionDto> {
    return this.uploads.begin(user, patientId, dto.type, dto.originalName);
  }
}

/**
 * A patient opening a resumable upload for their own file.
 *
 * A phone on hotel wifi is the case resumable uploads exist for, and the
 * patient is the one on it. The staff route needs `documents.write`, which a
 * patient must not have.
 */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me/documents/uploads')
export class MyBeginUploadController {
  constructor(
    private readonly uploads: ResumableUploadService,
    private readonly measurements: MeasurementsService,
  ) {}

  @Post()
  @RequireAnyPermission('self.write')
  @ApiOperation({ summary: 'Open a resumable upload for one of your own documents' })
  @ApiCreatedResponse({ type: UploadSessionDto })
  @ApiStandardErrors()
  async begin(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BeginUploadDto,
  ): Promise<UploadSessionDto> {
    const patientId = await this.measurements.ownPatientId(user);

    return this.uploads.begin(user, patientId, dto.type, dto.originalName);
  }
}

/**
 * Chunks and completion, addressed by session id.
 *
 * These accept `self.write` as well as `documents.write`: the session already
 * names a patient, and the service resolves it and applies the same scope check
 * as everywhere else — so a patient can finish an upload they opened, and still
 * cannot touch anybody else's.
 */
@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents/uploads')
export class UploadsController {
  constructor(private readonly uploads: ResumableUploadService) {}

  @Get(':sessionId')
  @RequireAnyPermission('documents.write', 'self.write')
  @ApiOperation({ summary: 'Where to resume from' })
  @ApiOkResponse({ type: UploadSessionDto })
  @ApiStandardErrors()
  async status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<UploadSessionDto> {
    return this.uploads.status(user, sessionId);
  }

  /**
   * The body is the raw chunk, read straight off the request stream. No body
   * parser touches it, so nothing is buffered and nothing reaches disk.
   */
  @Patch(':sessionId')
  @RequireAnyPermission('documents.write', 'self.write')
  @ApiConsumes('application/octet-stream')
  @ApiQuery({ name: 'offset', description: 'Must equal the server\'s receivedBytes' })
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiOperation({ summary: 'Send one chunk at an offset' })
  @ApiOkResponse({ type: UploadSessionDto })
  @ApiStandardErrors()
  async append(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Query('offset', ParseIntPipe) offset: number,
    @Req() request: Request,
  ): Promise<UploadSessionDto> {
    return this.uploads.appendChunk(user, sessionId, offset, request);
  }

  @Post(':sessionId/complete')
  @RequireAnyPermission('documents.write', 'self.write')
  @ApiOperation({ summary: 'Assemble the parts and file the document' })
  @ApiCreatedResponse({ type: UploadedDocumentDto })
  @ApiStandardErrors()
  async complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<UploadedDocumentDto> {
    const { document, jobId } = await this.uploads.complete(user, sessionId, dto.checksum);

    return {
      id: document.id,
      type: document.type,
      originalName: document.originalName,
      mime: document.mime,
      size: document.size,
      ocrStatus: document.ocrStatus,
      createdAt: document.createdAt,
      jobId,
    };
  }

  @Delete(':sessionId')
  @HttpCode(204)
  @RequireAnyPermission('documents.write', 'self.write')
  @ApiOperation({ summary: 'Give up on an upload and release its parts' })
  @ApiNoContentResponse()
  @ApiStandardErrors()
  async abort(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<void> {
    return this.uploads.abort(user, sessionId);
  }
}
