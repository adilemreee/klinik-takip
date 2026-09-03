import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { PatientListBuilder } from './patient-list.builder';
import { PatientSummaryBuilder } from './patient-summary.builder';

/** Patient summary PDFs and the export lifecycle (spec M12, T6.5). */
@Module({
  imports: [FilesModule],
  controllers: [ExportsController],
  providers: [ExportsService, PatientSummaryBuilder, PatientListBuilder],
  exports: [ExportsService, PatientSummaryBuilder, PatientListBuilder],
})
export class ExportsModule {}
