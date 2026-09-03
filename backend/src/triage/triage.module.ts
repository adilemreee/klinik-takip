import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { MessagingModule } from '../messaging/messaging.module';
import { TriageService } from './triage.service';

/**
 * Message triage (spec M4, M5).
 *
 * Imports the AI layer explicitly rather than reaching for a global, because
 * "which parts of this system talk to a model" is a question section 14 makes
 * somebody ask.
 */
@Module({
  imports: [AIModule, MessagingModule],
  providers: [TriageService],
  exports: [TriageService],
})
export class TriageModule {}
