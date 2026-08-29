import { Module } from '@nestjs/common';
import { DocumentsController, PatientDocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ResumableUploadService } from './resumable-upload.service';
import { BeginUploadController, UploadsController } from './uploads.controller';

@Module({
  // The upload controllers come first so `/documents/uploads/...` is matched
  // before any `/documents/:documentId` route can claim it.
  controllers: [
    BeginUploadController,
    UploadsController,
    PatientDocumentsController,
    DocumentsController,
  ],
  providers: [DocumentsService, ResumableUploadService],
  exports: [DocumentsService, ResumableUploadService],
})
export class DocumentsModule {}
