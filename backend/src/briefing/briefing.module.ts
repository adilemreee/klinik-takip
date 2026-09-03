import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { BriefingController } from './briefing.controller';
import { BriefingService } from './briefing.service';

/** The doctor's morning briefing (spec M5). */
@Module({
  imports: [AIModule],
  controllers: [BriefingController],
  providers: [BriefingService],
  exports: [BriefingService],
})
export class BriefingModule {}
