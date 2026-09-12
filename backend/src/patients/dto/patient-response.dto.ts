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

/**
 * The patient as the file header needs them.
 *
 * `PatientDto` plus the age, which the server computes so that two clients
 * cannot disagree about it — and which the published contract did not mention
 * at all until this existed.
 */
export class FilePatientDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  mrn!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  birthDate!: Date;

  @ApiProperty({ description: 'Whole years, computed on the server' })
  age!: number;

  @ApiProperty()
  sex!: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2' })
  country!: string;

  @ApiProperty({ nullable: true, type: String })
  city!: string | null;

  @ApiProperty({ nullable: true, type: String })
  nationality!: string | null;

  @ApiProperty()
  preferredLanguage!: string;

  @ApiProperty({ nullable: true, type: String })
  referralSource!: string | null;

  @ApiProperty()
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ description: 'For optimistic concurrency on writes' })
  version!: number;
}

export class PatientContactDto {
  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({ nullable: true, type: String })
  phone!: string | null;

  @ApiProperty({
    description:
      'Whether a login exists. A file is opened when somebody books and the account comes later, so false is an ordinary state',
  })
  hasAccount!: boolean;
}

/// One person responsible for a file, as the file header lists them: a name
/// already joined, because the header shows a name and not two columns.
export class FileAssignmentDto {
  @ApiProperty({ format: 'uuid' })
  staffId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  title!: string | null;

  @ApiProperty({ enum: Role })
  role!: Role;
}

export class FileLastMessageDto {
  @ApiProperty({ nullable: true, type: String, description: 'Null for an attachment with no text' })
  body!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  sentAt!: Date;

  @ApiProperty()
  fromPatient!: boolean;
}

export class NextAppointmentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  scheduledAt!: Date;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  status!: string;
}

export class NextFollowUpDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  dueAt!: Date;

  @ApiProperty()
  status!: string;
}

export class FileAdherenceDto {
  @ApiProperty({
    nullable: true,
    type: Number,
    description: '0–1 over the doses that have come due, or null when none have',
  })
  score!: number | null;

  @ApiProperty()
  taken!: number;

  @ApiProperty()
  missed!: number;

  @ApiProperty({ description: 'Doses that have come due and been answered' })
  due!: number;

  @ApiProperty({ description: 'Still ahead: not counted, not missed' })
  upcoming!: number;

  @ApiProperty({ description: 'Consecutive days, ending today, with every due dose taken' })
  streak!: number;

  @ApiProperty()
  activeMedications!: number;
}

export class FileCountsDto {
  @ApiProperty()
  documents!: number;

  @ApiProperty()
  photos!: number;

  @ApiProperty()
  labResults!: number;

  @ApiProperty()
  appointments!: number;
}

export class PatientFileSummaryDto {
  @ApiProperty({ type: FilePatientDto })
  patient!: FilePatientDto;

  @ApiProperty({
    type: PatientContactDto,
    description: "The account's e-mail and phone, and whether a login exists at all",
  })
  contact!: PatientContactDto;

  @ApiPropertyOptional({ type: MedicalProfileViewDto, nullable: true })
  medicalProfile!: MedicalProfileViewDto | null;

  @ApiPropertyOptional({ type: SurgeryViewDto, nullable: true })
  lastSurgery!: SurgeryViewDto | null;

  @ApiProperty({
    type: [FileAssignmentDto],
    description: 'Staff currently responsible for this file',
  })
  assignments!: FileAssignmentDto[];

  @ApiProperty({ type: [MeasurementViewDto], description: 'Newest reading of each kind' })
  latestMeasurements!: MeasurementViewDto[];

  @ApiProperty({ type: FileAlertsDto })
  alerts!: FileAlertsDto;

  @ApiPropertyOptional({ type: FileLastMessageDto, nullable: true })
  lastMessage!: FileLastMessageDto | null;

  @ApiProperty()
  unreadMessages!: number;

  @ApiPropertyOptional({ type: NextAppointmentDto, nullable: true })
  nextAppointment!: NextAppointmentDto | null;

  @ApiPropertyOptional({ type: NextFollowUpDto, nullable: true })
  nextFollowUp!: NextFollowUpDto | null;

  @ApiPropertyOptional({
    type: FileAdherenceDto,
    nullable: true,
    description: 'Null when nothing has been prescribed — not the same as zero',
  })
  adherence!: FileAdherenceDto | null;

  @ApiProperty({ type: FileCountsDto })
  counts!: FileCountsDto;
}
