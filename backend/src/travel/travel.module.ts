import { Module } from '@nestjs/common';
import { MyTravelController, TravelController } from './travel.controller';
import { TravelService } from './travel.service';

@Module({
  controllers: [TravelController, MyTravelController],
  providers: [TravelService],
  exports: [TravelService],
})
export class TravelModule {}
