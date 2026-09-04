import { Module } from '@nestjs/common';
import { MeasurementsModule } from '../measurements/measurements.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { PortabilityService } from './portability.service';

@Module({
  // MeasurementsModule for `ownPatientId`: resolving "which file is mine"
  // already lives there and duplicating it would let the two answers drift.
  imports: [MeasurementsModule],
  controllers: [MeController],
  providers: [MeService, PortabilityService],
})
export class MeModule {}
