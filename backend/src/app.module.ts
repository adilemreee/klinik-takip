import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { AuthzModule } from './authz/authz.module';
import { AuditModule } from './audit/audit.module';
import { FilesModule } from './files/files.module';
import { ComplicationsModule } from './complications/complications.module';
import { DocumentsModule } from './documents/documents.module';
import { PhotosModule } from './photos/photos.module';
import { QueueModule } from './queue/queue.module';
import { AIModule } from './ai/ai.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { EmergencyModule } from './emergency/emergency.module';
import { AssistantModule } from './assistant/assistant.module';
import { BriefingModule } from './briefing/briefing.module';
import { ProtocolsModule } from './protocols/protocols.module';
import { ReportsModule } from './reports/reports.module';
import { TriageModule } from './triage/triage.module';
import { FollowUpModule } from './followup/followup.module';
import { LabModule } from './lab/lab.module';
import { MeasurementsModule } from './measurements/measurements.module';
import { MessagingModule } from './messaging/messaging.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MeModule } from './me/me.module';
import { PatientsModule } from './patients/patients.module';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { InfraModule } from './infra/infra.module';
import { ObservabilityModule } from './observability/observability.module';

@Module({
  imports: [
    AppConfigModule,
    ObservabilityModule,
    InfraModule,
    // Application-level rate limiting. Cloudflare handles edge WAF and volumetric
    // limits; this protects specific endpoints (login, OTP) from abuse that gets
    // past the edge. See docs/SUNUCU-NOTLARI.md.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    HealthModule,
    AuthModule,
    AuthzModule,
    AuditModule,
    FilesModule,
    PatientsModule,
    MeModule,
    MeasurementsModule,
    DocumentsModule,
    LabModule,
    PhotosModule,
    ComplicationsModule,
    MessagingModule,
    NotificationsModule,
    FollowUpModule,
    AppointmentsModule,
    EmergencyModule,
    AIModule,
    TriageModule,
    ReportsModule,
    ProtocolsModule,
    AssistantModule,
    BriefingModule,
    QueueModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
