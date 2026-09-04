import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConsentType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RecordConsentDto {
  @ApiProperty({ enum: ConsentType, description: 'DATA_PROCESSING is refused; see the service' })
  @IsEnum(ConsentType)
  type!: ConsentType;

  /** Which wording was agreed to. Without it, "they consented" names nothing. */
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ description: 'The exact text shown, stored for proof' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  documentText?: string;
}

export class ConsentDto {
  @ApiProperty() id!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty({ enum: ConsentType }) type!: ConsentType;
  @ApiProperty() version!: number;
  @ApiProperty() signedAt!: Date;
  @ApiPropertyOptional({ nullable: true }) revokedAt!: Date | null;

  @ApiProperty({ description: 'Whether it is in force right now' })
  active!: boolean;
}
