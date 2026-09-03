import { Logger } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import type { PrismaService } from '../infra/prisma.service';
import type { PermissionsService } from '../authz/permissions.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/templates';
import type { JobHandler } from '../queue/job-runner';
import { localDate } from '../common/local-calendar';
import { BRIEFING_HOUR, CLINIC_TIMEZONE } from './briefing';
import type { BriefingService } from './briefing.service';

/**
 * The morning nudge (spec M5: "her sabah").
 *
 * Swept hourly and fired on the hour that is eight o'clock in the clinic, the
 * same shape the follow-up calendar uses. A cron expression in UTC would drift
 * by an hour twice a year and nobody would notice until a doctor mentioned that
 * the briefing arrives at seven now.
 *
 * Nobody is notified about a morning with nothing in it. A notification for an
 * empty briefing is the one that teaches people to ignore the rest of them.
 */
export function briefingSweep(
  prisma: PrismaService,
  permissions: PermissionsService,
  briefing: BriefingService,
  notifications: NotificationsService,
): JobHandler {
  const logger = new Logger('BriefingSweep');

  return async (): Promise<void> => {
    const now = new Date();
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: CLINIC_TIMEZONE,
        hour: '2-digit',
        hour12: false,
      }).format(now),
    );

    if (hour !== BRIEFING_HOUR) return;

    const candidates = await permissions.usersWith('medical.read');
    if (candidates.length === 0) return;

    const today = localDate(now, CLINIC_TIMEZONE);
    const worth = await briefing.recipientsWithBriefings(candidates, now);
    let sent = 0;

    for (const userId of worth) {
      // The sweep runs every hour and the hour lasts sixty minutes; without
      // this a doctor gets the same nudge on every run inside it.
      const already = await prisma.notification.count({
        where: {
          userId,
          type: NOTIFICATION_TYPES.briefingReady,
          channel: NotificationChannel.PUSH,
          createdAt: { gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
        },
      });

      if (already > 0) continue;

      const notification = await notifications.dispatch({
        userId,
        type: NOTIFICATION_TYPES.briefingReady,
        data: { date: `${today.year}-${today.month}-${today.day}` },
      });

      if (notification) sent += 1;
    }

    if (sent > 0) logger.log(`${sent} morning briefing(s) announced`);
  };
}
