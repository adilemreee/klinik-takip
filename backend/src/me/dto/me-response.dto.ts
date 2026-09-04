import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

class HomePatientDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '2026-K7RMPX' })
  mrn!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ example: 'tr' })
  preferredLanguage!: string;

  @ApiProperty()
  status!: string;
}

class NextAppointmentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  scheduledAt!: Date;

  @ApiProperty()
  type!: string;

  @ApiProperty({ nullable: true })
  location!: string | null;
}

export class PatientHomeSummaryDto {
  @ApiProperty({ type: HomePatientDto })
  patient!: HomePatientDto;

  @ApiProperty({ type: NextAppointmentDto, nullable: true })
  nextAppointment!: NextAppointmentDto | null;

  @ApiProperty({ description: 'Doses scheduled for today that are still waiting' })
  medicationsDueToday!: number;

  @ApiProperty()
  unreadMessages!: number;

  @ApiProperty({ description: 'Mandatory pre-op documents not yet uploaded (spec M17)' })
  missingDocuments!: number;
}

export class IdentityDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ enum: Role }) role!: Role;
  @ApiProperty({ description: "For the greeting; falls back to the account's own e-mail" })
  displayName!: string;
  @ApiProperty({
    nullable: true,
    description: 'The patient file this account is. Null for staff',
  })
  patientId!: string | null;
  @ApiProperty({ description: 'Whether the account belongs to the clinic rather than a patient' })
  isStaff!: boolean;
}
