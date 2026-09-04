import { Module } from '@nestjs/common';
import {
  DocumentsController,
  MyDocumentsController,
  PatientDocumentsController,
} from './documents.controller';
import { MeasurementsModule } from '../measurements/measurements.module';
import { DocumentsService } from './documents.service';
import { ResumableUploadService } from './resumable-upload.service';
import {
  BeginUploadController,
  MyBeginUploadController,
  UploadsController,
} from './uploads.controller';

@Module({
  imports: [MeasurementsModule],
  // The upload controllers come first so `/documents/uploads/...` is matched
  // before any `/documents/:documentId` route can claim it.
  controllers: [
    MyBeginUploadController,
    BeginUploadController,
    UploadsController,
    MyDocumentsController,
    PatientDocumentsController,
    DocumentsController,
  ],
  providers: [DocumentsService, ResumableUploadService],
  exports: [DocumentsService, ResumableUploadService],
})
export class DocumentsModule {}
