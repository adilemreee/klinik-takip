import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { MeasurementsModule } from '../measurements/measurements.module';
import { AIReportsController, MyReportsController, PatientReportsController } from './ai-reports.controller';
import { AIReportsService } from './ai-reports.service';

/** AI clinical reports (spec M5, T5.4). */
@Module({
  imports: [AIModule, MeasurementsModule],
  controllers: [AIReportsController, PatientReportsController, MyReportsController],
  providers: [AIReportsService],
  exports: [AIReportsService],
})
export class ReportsModule {}
