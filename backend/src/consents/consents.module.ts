import { Module } from '@nestjs/common';
import { MeasurementsModule } from '../measurements/measurements.module';
import { MyConsentsController, PatientConsentsController } from './consents.controller';
import { ConsentsService } from './consents.service';

@Module({
  imports: [MeasurementsModule],
  controllers: [MyConsentsController, PatientConsentsController],
  providers: [ConsentsService],
  exports: [ConsentsService],
})
export class ConsentsModule {}
