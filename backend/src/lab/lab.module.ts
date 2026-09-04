import { Module } from '@nestjs/common';
import { TesseractEngine } from '../ocr/tesseract.engine';
import { LabResultsController, MyLabController, PatientLabController } from './lab.controller';
import { MeasurementsModule } from '../measurements/measurements.module';
import { LabService } from './lab.service';

@Module({
  imports: [MeasurementsModule],
  controllers: [MyLabController, PatientLabController, LabResultsController],
  providers: [LabService, TesseractEngine],
  exports: [LabService, TesseractEngine],
})
export class LabModule {}
