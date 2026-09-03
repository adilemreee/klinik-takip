import { Module } from '@nestjs/common';
import { MeasurementsModule } from '../measurements/measurements.module';
import {
  MedicationsController,
  MyMedicationsController,
  PatientMedicationsController,
} from './medications.controller';
import { MedicationsService } from './medications.service';

/** Medication plans, reminders, check-in and adherence (spec M9, T6.1). */
@Module({
  // MeasurementsModule for `ownPatientId`: resolving "which file is mine" lives
  // there and duplicating it would let the two answers drift.
  imports: [MeasurementsModule],
  controllers: [
    PatientMedicationsController,
    MedicationsController,
    MyMedicationsController,
  ],
  providers: [MedicationsService],
  exports: [MedicationsService],
})
export class MedicationsModule {}
