import { Global, Module, OnModuleInit } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { MyNotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { UnconfiguredSender } from './senders';

/**
 * Global because every clinical module eventually has something to tell
 * someone: a result, a reminder, a reply.
 */
@Global()
@Module({
  controllers: [MyNotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule implements OnModuleInit {
  constructor(private readonly notifications: NotificationsService) {}

  /**
   * Attaches a sender per channel.
   *
   * All of them report failure until real credentials exist. That is
   * deliberate: a stub that claimed success would leave the fallback chain
   * untested, the log full of "sent", and the first sign of trouble a patient
   * saying nobody told them.
   */
  onModuleInit(): void {
    for (const channel of [
      NotificationChannel.PUSH,
      NotificationChannel.SMS,
      NotificationChannel.EMAIL,
    ]) {
      this.notifications.registerSender(new UnconfiguredSender(channel));
    }
  }
}
