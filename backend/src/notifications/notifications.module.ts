import { Global, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel } from '@prisma/client';
import { Env } from '../config/env.schema';
import { ApnsSender } from './apns.sender';
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
export class NotificationsModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsModule.name);
  private apns: ApnsSender | null = null;

  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Attaches a sender per channel.
   *
   * Push is real now; SMS and e-mail still report failure, and deliberately
   * so. A stub that claimed success would leave the fallback chain untested,
   * the log full of "sent", and the first sign of trouble a patient saying
   * nobody told them.
   */
  onModuleInit(): void {
    this.notifications.registerSender(this.pushSender());

    for (const channel of [NotificationChannel.SMS, NotificationChannel.EMAIL]) {
      this.notifications.registerSender(new UnconfiguredSender(channel));
    }
  }

  onModuleDestroy(): void {
    this.apns?.close();
  }

  /**
   * APNs when it is fully configured, and the honest stub when it is not.
   *
   * All four settings or none: a key id without a team id is a push channel
   * that fails on every notification, which from the outside is the same as
   * not having one — except that it looks configured.
   */
  private pushSender(): ApnsSender | UnconfiguredSender {
    const keyId = this.config.get('APNS_KEY_ID', { infer: true });
    const teamId = this.config.get('APNS_TEAM_ID', { infer: true });
    const topic = this.config.get('APNS_TOPIC', { infer: true });
    const keyBase64 = this.config.get('APNS_KEY_BASE64', { infer: true });

    if (!keyId || !teamId || !topic || !keyBase64) {
      return new UnconfiguredSender(NotificationChannel.PUSH);
    }

    const production = this.config.get('APNS_PRODUCTION', { infer: true });

    try {
      this.apns = new ApnsSender({
        keyId,
        teamId,
        topic,
        privateKey: Buffer.from(keyBase64, 'base64').toString('utf8'),
        production,
      });
    } catch (error) {
      // A malformed key is a configuration mistake, and saying so once at
      // boot is more use than the same parse failure on every notification.
      this.logger.error(
        `APNs key could not be read; push stays unconfigured: ${String(error)}`,
      );

      return new UnconfiguredSender(NotificationChannel.PUSH);
    }

    this.logger.log(
      `Push configured for ${topic} on the ${production ? 'production' : 'sandbox'} gateway`,
    );

    return this.apns;
  }
}
