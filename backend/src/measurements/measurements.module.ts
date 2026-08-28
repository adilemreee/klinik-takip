import { Module } from '@nestjs/common';
import { MeasurementsController, MyMeasurementsController } from './measurements.controller';
import { MeasurementsService } from './measurements.service';

@Module({
  controllers: [MeasurementsController, MyMeasurementsController],
  providers: [MeasurementsService],
})
export class MeasurementsModule {}
