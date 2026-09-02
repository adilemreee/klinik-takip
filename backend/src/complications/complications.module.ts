import { Module } from '@nestjs/common';
import { MeasurementsModule } from '../measurements/measurements.module';
import {
  ComplicationsController,
  MyComplicationsController,
  PatientComplicationsController,
} from './complications.controller';
import { ComplicationsService } from './complications.service';

@Module({
  // MeasurementsModule for `ownPatientId`: resolving "which file is mine"
  // already lives there and duplicating it would let the two answers drift.
  imports: [MeasurementsModule],
  controllers: [
    MyComplicationsController,
    ComplicationsController,
    PatientComplicationsController,
  ],
  providers: [ComplicationsService],
  exports: [ComplicationsService],
})
export class ComplicationsModule {}
