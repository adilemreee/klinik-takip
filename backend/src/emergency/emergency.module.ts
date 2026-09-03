import { Module } from '@nestjs/common';
import { MeasurementsModule } from '../measurements/measurements.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmergencyController, MyEmergencyController } from './emergency.controller';
import { EmergencyService } from './emergency.service';

@Module({
  imports: [MeasurementsModule, NotificationsModule],
  controllers: [MyEmergencyController, EmergencyController],
  providers: [EmergencyService],
  exports: [EmergencyService],
})
export class EmergencyModule {}
