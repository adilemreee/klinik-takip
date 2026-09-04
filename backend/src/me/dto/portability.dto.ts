import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The shape of a portability export (KVKK m.11).
 *
 * Described rather than left as a free-form object because the clients
 * generate from this contract, and "some JSON" is not something a client can
 * be written against. The collections are typed loosely on purpose — their
 * contents mirror the clinical models, which are documented in their own right,
 * and duplicating every field here would be a second copy to drift.
 */
export class PortablePatientDto {
  @ApiProperty() id!: string;
  @ApiProperty() mrn!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty() birthDate!: Date;
  @ApiProperty() sex!: string;
  @ApiProperty() country!: string;
  @ApiPropertyOptional({ nullable: true }) city!: string | null;
  @ApiPropertyOptional({ nullable: true }) nationality!: string | null;
  @ApiProperty() preferredLanguage!: string;
  @ApiProperty() status!: string;
  @ApiProperty() createdAt!: Date;
}

export class DataExportDto {
  @ApiProperty({ description: 'When this file was produced' })
  exportedAt!: string;

  @ApiProperty({ example: 'klinik-portability-1', description: 'Format identifier' })
  format!: string;

  @ApiProperty({ type: PortablePatientDto })
  patient!: PortablePatientDto;

  @ApiPropertyOptional({ type: Object, nullable: true })
  medicalProfile!: Record<string, unknown> | null;

  @ApiProperty({ type: [Object] }) measurements!: Record<string, unknown>[];
  @ApiProperty({ type: [Object] }) documents!: Record<string, unknown>[];

  @ApiProperty({
    type: [Object],
    description: 'Confirmed results only; an unreviewed OCR reading is not a lab result',
  })
  labResults!: Record<string, unknown>[];

  @ApiProperty({ type: [Object] }) photos!: Record<string, unknown>[];
  @ApiProperty({ type: [Object] }) appointments!: Record<string, unknown>[];
  @ApiProperty({ type: [Object] }) medications!: Record<string, unknown>[];
  @ApiProperty({ type: [Object] }) complications!: Record<string, unknown>[];
  @ApiProperty({ type: [Object] }) consents!: Record<string, unknown>[];
  @ApiProperty({ type: [Object] }) surveyResponses!: Record<string, unknown>[];

  @ApiProperty({
    type: [String],
    description: 'What this file deliberately leaves out, and it says so in the file',
  })
  notIncluded!: string[];
}
