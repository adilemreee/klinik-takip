import { Module } from '@nestjs/common';
import { TesseractEngine } from '../ocr/tesseract.engine';
import { LabResultsController, PatientLabController } from './lab.controller';
import { LabService } from './lab.service';

@Module({
  controllers: [PatientLabController, LabResultsController],
  providers: [LabService, TesseractEngine],
  exports: [LabService, TesseractEngine],
})
export class LabModule {}
