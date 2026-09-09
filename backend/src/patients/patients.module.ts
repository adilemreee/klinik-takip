import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { PatientFileSummaryService } from './file-summary.service';

@Module({
  controllers: [PatientsController],
  providers: [PatientsService, PatientFileSummaryService],
  exports: [PatientsService],
})
export class PatientsModule {}
