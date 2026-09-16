import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { DocumentClassifier } from './document-classifier.service';
import {
  DocumentsController,
  MyDocumentsController,
  PatientDocumentsController,
} from './documents.controller';
import { MeasurementsModule } from '../measurements/measurements.module';
import { DocumentChecklistService } from './checklist.service';
import { DocumentsService } from './documents.service';
import { ResumableUploadService } from './resumable-upload.service';
import {
  BeginUploadController,
  MyBeginUploadController,
  UploadsController,
} from './uploads.controller';

@Module({
  imports: [AIModule, MeasurementsModule],
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
  providers: [DocumentClassifier, DocumentsService, ResumableUploadService, DocumentChecklistService],
  exports: [DocumentClassifier, DocumentsService, ResumableUploadService, DocumentChecklistService],
})
export class DocumentsModule {}
