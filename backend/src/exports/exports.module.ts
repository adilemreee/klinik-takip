import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { PatientSummaryBuilder } from './patient-summary.builder';

/** Patient summary PDFs and the export lifecycle (spec M12, T6.5). */
@Module({
  imports: [FilesModule],
  controllers: [ExportsController],
  providers: [ExportsService, PatientSummaryBuilder],
  exports: [ExportsService, PatientSummaryBuilder],
})
export class ExportsModule {}
