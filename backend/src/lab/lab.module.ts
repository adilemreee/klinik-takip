import { Module } from '@nestjs/common';
import { TesseractEngine } from '../ocr/tesseract.engine';
import { LabResultsController, MyLabController, PatientLabController } from './lab.controller';
import { MeasurementsModule } from '../measurements/measurements.module';
import { AIModule } from '../ai/ai.module';
import { LabReader } from './lab-reader.service';
import { LabService } from './lab.service';

@Module({
  imports: [MeasurementsModule, AIModule],
  controllers: [MyLabController, PatientLabController, LabResultsController],
  providers: [LabService, LabReader, TesseractEngine],
  exports: [LabService, LabReader, TesseractEngine],
})
export class LabModule {}
