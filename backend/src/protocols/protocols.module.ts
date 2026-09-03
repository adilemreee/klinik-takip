import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { ProtocolsController } from './protocols.controller';
import { ProtocolsService } from './protocols.service';

/** The corpus the FAQ assistant answers from (spec M4). */
@Module({
  imports: [AIModule],
  controllers: [ProtocolsController],
  providers: [ProtocolsService],
  exports: [ProtocolsService],
})
export class ProtocolsModule {}
