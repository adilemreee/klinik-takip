import { Global, Module } from '@nestjs/common';
import { FileService } from './file.service';

/**
 * Global because every clinical module stores something: documents, photos,
 * consent signatures, generated reports.
 */
@Global()
@Module({
  providers: [FileService],
  exports: [FileService],
})
export class FilesModule {}
