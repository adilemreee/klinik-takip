import { ApiProperty } from '@nestjs/swagger';
import { PatientStatus, Role, Sex } from '@prisma/client';

export class PatientDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'File number, e.g. 2026-K7RMPX', example: '2026-K7RMPX' })
  mrn!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ type: String, format: 'date' })
  birthDate!: Date;

  @ApiProperty({ enum: Sex })
  sex!: Sex;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2, always upper case', example: 'DE' })
  country!: string;

  @ApiProperty({ nullable: true })
  city!: string | null;

  @ApiProperty({ nullable: true })
  nationality!: string | null;

  @ApiProperty({ example: 'tr' })
  preferredLanguage!: string;

  @ApiProperty({ nullable: true, description: 'Instagram, Google, agency, referral…' })
  referralSource!: string | null;

  @ApiProperty({ enum: PatientStatus })
  status!: PatientStatus;

  @ApiProperty({ format: 'uuid', nullable: true })
  assignedDoctorId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({
    description:
      'Send this back as expectedVersion when editing. A mismatch means someone ' +
      'else changed the record and the write is refused (spec M15).',
    example: 1,
  })
  version!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Set when the file is deactivated. Records are retained by law, not destroyed.',
  })
  deletedAt!: Date | null;
}

export class PatientPageDto {
  @ApiProperty({ type: [PatientDto] })
  items!: PatientDto[];

  @ApiProperty({
    nullable: true,
    description: 'Pass as `cursor` for the next page. Null on the last page.',
  })
  nextCursor!: string | null;
}

export class AssignedStaffDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ nullable: true })
  title!: string | null;
}

export class AssignmentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: Role })
  role!: Role;

  @ApiProperty({ type: String, format: 'date-time' })
  assignedAt!: Date;

  @ApiProperty({ type: AssignedStaffDto })
  staff!: AssignedStaffDto;
}
