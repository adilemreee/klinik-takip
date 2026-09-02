import { Module } from '@nestjs/common';
import { MeasurementsModule } from '../measurements/measurements.module';
import {
  MilestonesController,
  MyFollowUpController,
  PatientFollowUpController,
} from './followup.controller';
import { FollowUpService } from './followup.service';

@Module({
  imports: [MeasurementsModule],
  controllers: [PatientFollowUpController, MilestonesController, MyFollowUpController],
  providers: [FollowUpService],
  exports: [FollowUpService],
})
export class FollowUpModule {}
