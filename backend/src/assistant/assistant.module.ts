import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { MeasurementsModule } from '../measurements/measurements.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ProtocolsModule } from '../protocols/protocols.module';
import { TriageModule } from '../triage/triage.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

/** The FAQ chatbot (spec M4). */
@Module({
  imports: [AIModule, ProtocolsModule, TriageModule, MessagingModule, MeasurementsModule],
  controllers: [AssistantController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
