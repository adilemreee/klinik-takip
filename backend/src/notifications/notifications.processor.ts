import { Logger } from '@nestjs/common';
import type { JobHandler } from '../queue/job-runner';
import type { NotificationsService } from './notifications.service';

/**
 * Sends what is due (spec M6).
 *
 * Each run advances the fallback chain by one link rather than looping until
 * something lands: a channel that is merely slow gets its moment, and a chain
 * that would otherwise spin through push, SMS and e-mail inside one second
 * gives none of them a chance.
 */
export function notificationDelivery(notifications: NotificationsService): JobHandler {
  const logger = new Logger('NotificationDelivery');

  return async (): Promise<void> => {
    const delivered = await notifications.deliverDue();

    if (delivered > 0) {
      logger.log(`Delivered ${delivered} notification(s)`);
    }
  };
}
