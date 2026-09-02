import { Module } from '@nestjs/common';
import { MeasurementsModule } from '../measurements/measurements.module';
import {
  AppointmentsController,
  MyAppointmentsController,
  PatientAppointmentsController,
} from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [MeasurementsModule],
  controllers: [
    AppointmentsController,
    PatientAppointmentsController,
    MyAppointmentsController,
  ],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
