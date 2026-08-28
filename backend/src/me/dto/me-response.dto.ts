import { ApiProperty } from '@nestjs/swagger';

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
