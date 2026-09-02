import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PhotoCategory } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class ListPhotosDto {
  @ApiPropertyOptional({ enum: PhotoCategory })
  @IsOptional()
  @IsEnum(PhotoCategory)
  category?: PhotoCategory;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bodyArea?: string;
}

export class OverlayQueryDto {
  @ApiProperty({ description: 'The body area the new photo will show' })
  @IsString()
  @MaxLength(100)
  bodyArea!: string;
}

export class PhotoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: PhotoCategory })
  category!: PhotoCategory;

  @ApiProperty({ nullable: true })
  bodyArea!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Free text: milestones differ per procedure (pre-op, post-op D1, W2, M1…)',
  })
  phaseLabel!: string | null;

  @ApiProperty()
  mime!: string;

  @ApiProperty()
  size!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  takenAt!: Date;

  @ApiProperty({ description: 'Location metadata was removed before storing' })
  exifStripped!: boolean;

  @ApiProperty()
  isFaceBlurred!: boolean;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Photo-usage consent; without one the photo is clinical-use only',
  })
  consentId!: string | null;

  @ApiProperty({ nullable: true })
  note!: string | null;
}

export class GalleryGroupDto {
  @ApiProperty({ nullable: true })
  bodyArea!: string | null;

  @ApiProperty({ type: [PhotoDto], description: 'Oldest first: a progression reads forwards' })
  photos!: PhotoDto[];
}

export class PhotoUrlDto {
  @ApiProperty({ description: 'Short-lived and single-purpose; never stored' })
  url!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: Date;
}
