import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';

export interface Deliverable {
  channel: NotificationChannel;
  /** Push token, phone number or e-mail address, depending on the channel. */
  address: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface DeliveryResult {
  delivered: boolean;
  /** Why not, in a form safe to store and show staff. */
  reason?: string;
  /** True when the address is dead and should stop being used. */
  addressGone?: boolean;
}

export interface NotificationSender {
  readonly channel: NotificationChannel;
  send(message: Deliverable): Promise<DeliveryResult>;
}

/**
 * A sender that logs and reports failure.
 *
 * The real ones — APNs, FCM, an SMS gateway, an SMTP relay — need credentials
 * this deployment does not have yet, and inventing a success it did not have
 * would be worse than useless: the fallback chain would never fire, the
 * notification log would say "sent" for everything, and the first anyone knew
 * would be a patient saying they were never told.
 *
 * Reporting failure means the chain behaves exactly as it will in production,
 * and every attempt is on the record.
 */
@Injectable()
export class UnconfiguredSender implements NotificationSender {
  private readonly logger = new Logger('NotificationSender');

  constructor(readonly channel: NotificationChannel) {}

  send(message: Deliverable): Promise<DeliveryResult> {
    this.logger.warn(
      `${this.channel} not configured — "${message.title}" was not delivered to this recipient`,
    );

    return Promise.resolve({
      delivered: false,
      reason: `${this.channel} provider is not configured`,
    });
  }
}
