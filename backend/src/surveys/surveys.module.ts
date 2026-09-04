import { Module } from '@nestjs/common';
import { MeasurementsModule } from '../measurements/measurements.module';
import { MySurveysController, PatientSurveysController } from './surveys.controller';
import { SurveysService } from './surveys.service';

/** Patient-reported outcome questionnaires (spec M18, T6.7). */
@Module({
  // For `ownPatientId`: resolving "which file is mine" lives there, and a
  // second answer to that question would eventually disagree with the first.
  imports: [MeasurementsModule],
  controllers: [MySurveysController, PatientSurveysController],
  providers: [SurveysService],
  exports: [SurveysService],
})
export class SurveysModule {}
