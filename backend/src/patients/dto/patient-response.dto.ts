import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

/**
 * The patient file's header (spec M2).
 *
 * Documented field by field because this is the response an app screen is laid
 * out from, and a client author reading the schema should be able to tell what
 * a null means without reading the service.
 */
export class MedicalProfileViewDto {
  @ApiPropertyOptional({ nullable: true, example: 'A Rh+' })
  bloodType!: string | null;

  @ApiProperty({ type: [String] })
  allergies!: string[];

  @ApiProperty({ type: [String] })
  chronicConditions!: string[];

  @ApiProperty({ type: [String], description: 'What the patient says they take, not the plan' })
  currentMedications!: string[];

  @ApiPropertyOptional({ nullable: true })
  smoking!: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  alcohol!: boolean | null;

  @ApiPropertyOptional({ nullable: true, description: 'Decimal as a string' })
  targetWeightKg!: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ description: 'Send this back when editing, to catch a concurrent change' })
  version!: number;
}

export class SurgeryViewDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  procedureName!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  performedAt!: Date;

  @ApiProperty({ description: 'Whole days since the operation' })
  daysAgo!: number;

  @ApiPropertyOptional({ nullable: true })
  location!: string | null;

  @ApiPropertyOptional({ nullable: true })
  surgeonName!: string | null;
}

export class MeasurementViewDto {
  @ApiProperty({ example: 'WEIGHT' })
  type!: string;

  @ApiProperty({ description: 'Decimal as a string' })
  value!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Diastolic, for blood pressure' })
  secondaryValue!: string | null;

  @ApiProperty({ example: 'kg' })
  unit!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  measuredAt!: Date;

  @ApiProperty({ example: 'NURSE' })
  source!: string;
}

export class FileAlertsDto {
  @ApiProperty({ description: 'Verified results flagged critical' })
  criticalLabs!: number;

  @ApiProperty({ description: 'Results the clinic has not confirmed yet' })
  labsAwaitingReview!: number;

  @ApiProperty()
  openComplications!: number;

  @ApiProperty()
  openEmergency!: boolean;

  @ApiProperty({ description: 'Uploads still in OCR' })
  processingDocuments!: number;

  @ApiProperty({ description: 'AI output nobody has signed off' })
  unreviewedReports!: number;
}

export class PatientFileSummaryDto {
  @ApiProperty({ type: PatientDto })
  patient!: unknown;

  @ApiProperty({ description: "The account's e-mail and phone, when one is linked" })
  contact!: { email: string | null; phone: string | null };

  @ApiPropertyOptional({ type: MedicalProfileViewDto, nullable: true })
  medicalProfile!: MedicalProfileViewDto | null;

  @ApiPropertyOptional({ type: SurgeryViewDto, nullable: true })
  lastSurgery!: SurgeryViewDto | null;

  @ApiProperty({ description: 'Staff currently responsible for this file' })
  assignments!: { staffId: string; name: string; title: string | null; role: Role }[];

  @ApiProperty({ type: [MeasurementViewDto], description: 'Newest reading of each kind' })
  latestMeasurements!: MeasurementViewDto[];

  @ApiProperty({ type: FileAlertsDto })
  alerts!: FileAlertsDto;

  @ApiPropertyOptional({ nullable: true })
  lastMessage!: { body: string | null; sentAt: Date; fromPatient: boolean } | null;

  @ApiProperty()
  unreadMessages!: number;

  @ApiPropertyOptional({ nullable: true })
  nextAppointment!: { id: string; scheduledAt: Date; type: string; status: string } | null;

  @ApiPropertyOptional({ nullable: true })
  nextFollowUp!: { id: string; label: string; dueAt: Date; status: string } | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Null when nothing has been prescribed — not the same as zero',
  })
  adherence!: unknown;

  @ApiProperty()
  counts!: { documents: number; photos: number; labResults: number; appointments: number };
}
