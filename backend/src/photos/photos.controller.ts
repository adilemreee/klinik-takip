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
import { AuditAction, Photo, PhotoCategory } from '@prisma/client';
import type { Request } from 'express';
import { Audit } from '../audit/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../authz/decorators/require-permissions.decorator';
import { ApiStandardErrors } from '../common/decorators/api-errors.decorator';
import { firstFilePart } from '../documents/multipart';
import { GalleryGroup, PhotosService } from './photos.service';
import {
  GalleryGroupDto,
  ListPhotosDto,
  OverlayQueryDto,
  PhotoDto,
  PhotoUrlDto,
} from './dto/photo.dto';

@ApiTags('photos')
@ApiBearerAuth()
@Controller('patients/:id/photos')
export class PatientPhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Post()
  @RequirePermissions('photos.write')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a clinical photo; metadata is removed before storing' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'category'],
      properties: {
        file: { type: 'string', format: 'binary' },
        category: { type: 'string', enum: Object.values(PhotoCategory) },
        bodyArea: { type: 'string' },
        phaseLabel: { type: 'string', example: 'post-op M1' },
        takenAt: { type: 'string', format: 'date-time' },
        note: { type: 'string' },
        consentId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiCreatedResponse({ type: PhotoDto })
  @ApiStandardErrors()
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Req() request: Request,
  ): Promise<Photo> {
    const part = await firstFilePart(request, 64 * 1024 * 1024);

    return this.photos.upload(user, patientId, part, {
      category: this.parseCategory(part.fields.category),
      bodyArea: part.fields.bodyArea,
      phaseLabel: part.fields.phaseLabel,
      takenAt: part.fields.takenAt ? new Date(part.fields.takenAt) : undefined,
      note: part.fields.note,
      consentId: part.fields.consentId,
    });
  }

  @Get()
  @RequirePermissions('photos.read')
  @Audit({ entityType: 'photos', action: AuditAction.READ, patientIdParam: 'id' })
  @ApiOperation({ summary: 'The before/after gallery, grouped by body area' })
  @ApiOkResponse({ type: [GalleryGroupDto] })
  @ApiStandardErrors()
  async gallery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Query() query: ListPhotosDto,
  ): Promise<GalleryGroup[]> {
    return this.photos.gallery(user, patientId, query);
  }

  /**
   * The photo a new capture lines up against, for the translucent guide
   * (spec M7). Null when this is the first of its body area.
   */
  @Get('overlay')
  @RequirePermissions('photos.read')
  @ApiOperation({ summary: 'The reference photo for a consistent new capture' })
  @ApiOkResponse({ type: PhotoDto, description: 'Null when there is nothing to line up against' })
  @ApiStandardErrors()
  async overlay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) patientId: string,
    @Query() query: OverlayQueryDto,
  ): Promise<Photo | null> {
    return this.photos.overlayReference(user, patientId, query.bodyArea);
  }

  /** An unknown category would file a wound photo where nobody looks for it. */
  private parseCategory(value: string | undefined): PhotoCategory {
    if (!value || !(Object.values(PhotoCategory) as string[]).includes(value)) {
      throw new BadRequestException(`Unknown photo category: ${value ?? '(none)'}`);
    }

    return value as PhotoCategory;
  }
}

@ApiTags('photos')
@ApiBearerAuth()
@Controller('photos')
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Get(':photoId/url')
  @RequirePermissions('photos.read')
  @ApiOperation({ summary: 'A short-lived signed URL for the image' })
  @ApiOkResponse({ type: PhotoUrlDto })
  @ApiStandardErrors()
  async url(
    @CurrentUser() user: AuthenticatedUser,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<PhotoUrlDto> {
    return this.photos.viewUrl(user, photoId);
  }

  @Delete(':photoId')
  @HttpCode(204)
  @RequirePermissions('photos.write')
  @ApiOperation({ summary: 'Soft-delete; the bytes stay for the retention period' })
  @ApiNoContentResponse()
  @ApiStandardErrors()
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<void> {
    return this.photos.remove(user, photoId);
  }
}
