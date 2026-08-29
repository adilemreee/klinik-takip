import {
  BadRequestException,
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
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuditAction, DocumentType, Job } from '@prisma/client';
import type { Request } from 'express';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { Env } from '../config/env.schema';
import { DocumentsService } from './documents.service';
import {
  DocumentPageDto,
  DownloadUrlDto,
  JobDto,
  ListDocumentsDto,
  UploadedDocumentDto,
} from './dto/document.dto';
import { firstFilePart } from './multipart';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('patients/:id/documents')
export class PatientDocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * The body is read as a stream rather than through a body parser: nothing
   * touches the server filesystem (spec section 8), and holding 20 MB per
   * concurrent upload in memory is a denial of service waiting to happen.
   */
  @Post()
  @RequirePermissions('documents.write')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a document and queue it for processing' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: {
          type: 'string',
          enum: Object.values(DocumentType),
          default: DocumentType.OTHER,
        },
      },
    },
  })
  @ApiCreatedResponse({ type: UploadedDocumentDto })
  @ApiStandardErrors()
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Req() request: Request,
  ): Promise<UploadedDocumentDto> {
    const part = await firstFilePart(
      request,
      this.config.get('UPLOAD_MAX_BYTES', { infer: true }),
    );

    const type = this.parseType(part.fields.type);

    const { document, jobId } = await this.documents.upload(user, patientId, part, type);

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

  @Get()
  @RequirePermissions('documents.read')
  @Audit({ entityType: 'documents', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: "A patient's documents, newest first" })
  @ApiOkResponse({ type: DocumentPageDto })
  @ApiStandardErrors()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Query() query: ListDocumentsDto,
  ): Promise<DocumentPageDto> {
    return this.documents.list(user, patientId, query);
  }

  /**
   * An unknown type is refused rather than filed as OTHER: a lab report
   * silently stored as "other" is one that never reaches the OCR pipeline.
   */
  private parseType(value: string | undefined): DocumentType {
    if (value === undefined || value === '') {
      return DocumentType.OTHER;
    }

    if (!(Object.values(DocumentType) as string[]).includes(value)) {
      throw new BadRequestException(`Unknown document type: ${value}`);
    }

    return value as DocumentType;
  }
}

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get(':documentId/download')
  @RequirePermissions('documents.read')
  @ApiOperation({ summary: 'A short-lived signed URL for the stored file' })
  @ApiOkResponse({ type: DownloadUrlDto })
  @ApiStandardErrors()
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<DownloadUrlDto> {
    return this.documents.downloadUrl(user, documentId);
  }

  @Get(':documentId/jobs')
  @RequirePermissions('documents.read')
  @ApiOperation({ summary: 'What processing has happened to this document' })
  @ApiOkResponse({ type: [JobDto] })
  @ApiStandardErrors()
  async jobs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<Job[]> {
    return this.documents.jobsFor(user, documentId);
  }

  @Delete(':documentId')
  @HttpCode(204)
  @RequirePermissions('documents.write')
  @ApiOperation({ summary: 'Soft-delete; the bytes stay for the retention period' })
  @ApiNoContentResponse()
  @ApiStandardErrors()
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<void> {
    return this.documents.remove(user, documentId);
  }
}
