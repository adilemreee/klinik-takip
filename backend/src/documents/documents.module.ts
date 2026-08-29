import { Module } from '@nestjs/common';
import { DocumentsController, PatientDocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  controllers: [PatientDocumentsController, DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
