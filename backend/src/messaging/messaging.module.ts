import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MeasurementsModule } from '../measurements/measurements.module';
import {
  ConversationsController,
  MyConversationController,
  PatientConversationController,
  QuickRepliesController,
} from './messaging.controller';
import { MessagingGateway } from './messaging.gateway';
import { MessagingService } from './messaging.service';

@Module({
  // For `ownPatientId`: resolving "which file is mine" already lives in
  // MeasurementsModule and duplicating it would let the two answers drift.
  // JwtModule for the gateway, which verifies the same access token the REST
  // side does. Registered empty: the secret is passed per call, so the two
  // paths cannot end up trusting different keys.
  imports: [JwtModule.register({}), MeasurementsModule],
  controllers: [
    ConversationsController,
    QuickRepliesController,
    PatientConversationController,
    MyConversationController,
  ],
  providers: [MessagingService, MessagingGateway],
  exports: [MessagingService, MessagingGateway],
})
export class MessagingModule {}
