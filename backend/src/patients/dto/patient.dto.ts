import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PatientStatus, Role, Sex } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePatientDto {
  @ApiProperty()
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 100)
  lastName!: string;

  @ApiProperty({ type: String, format: 'date' })
  @Type(() => Date)
  @IsDate()
  birthDate!: Date;

  @ApiProperty({ enum: Sex })
  @IsEnum(Sex)
  sex!: Sex;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2, drives language and discharge advice' })
  @IsString()
  @Length(2, 2)
  country!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string;

  @ApiPropertyOptional({ default: 'tr' })
  @IsOptional()
  @IsString()
  @Length(2, 10)
  preferredLanguage?: string;

  @ApiPropertyOptional({ description: 'Instagram, Google, agency, referral…' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referralSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedDoctorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  agencyId?: string;
}

export class UpdatePatientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;

  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  birthDate?: Date;

  @ApiPropertyOptional({ enum: Sex })
  @IsOptional()
  @IsEnum(Sex)
  sex?: Sex;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 10)
  preferredLanguage?: string;

  @ApiPropertyOptional({ enum: PatientStatus })
  @IsOptional()
  @IsEnum(PatientStatus)
  status?: PatientStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedDoctorId?: string;

  /**
   * The version the client read. Sent by the offline queue, which may be
   * replaying an edit made hours ago; omitted when editing something just
   * fetched. A mismatch is refused rather than merged (spec M15).
   */
  @ApiPropertyOptional({ description: 'Version the client read; a mismatch is refused' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class MedicalProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  bloodType?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergies?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  chronicConditions?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  currentMedications?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  smoking?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  alcohol?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  /**
   * The version the client read. Sent by the offline queue, which may be
   * replaying an edit made hours ago; omitted when editing something just
   * fetched. A mismatch is refused rather than merged (spec M15).
   */
  @ApiPropertyOptional({ description: 'Version the client read; a mismatch is refused' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class SearchPatientsDto {
  @ApiPropertyOptional({ description: 'Name or file number; tolerant of misspelling' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: PatientStatus })
  @IsOptional()
  @IsEnum(PatientStatus)
  status?: PatientStatus;

  @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedDoctorId?: string;

  @ApiPropertyOptional({ description: 'Matches the procedure name of a recorded surgery' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  procedure?: string;

  @ApiPropertyOptional({ description: 'Surgeries on or after this date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  surgeryFrom?: Date;

  @ApiPropertyOptional({ description: 'Surgeries on or before this date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  surgeryTo?: Date;

  @ApiPropertyOptional({ description: 'Id of the last row from the previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AssignStaffDto {
  @ApiProperty()
  @IsUUID()
  staffId!: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role!: Role;
}
