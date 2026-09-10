import { Module } from '@nestjs/common';
import { MeasurementsModule } from '../measurements/measurements.module';
import { MyConsentsController, PatientConsentsController } from './consents.controller';
import { ConsentsService } from './consents.service';

@Module({
  // FilesModule is @Global — it says so, and lists consent signatures as one
  // of the reasons — so it is not imported here.
  imports: [MeasurementsModule],
  controllers: [MyConsentsController, PatientConsentsController],
  providers: [ConsentsService],
  exports: [ConsentsService],
})
export class ConsentsModule {}
