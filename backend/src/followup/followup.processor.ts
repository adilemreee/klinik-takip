import { Logger } from '@nestjs/common';
import type { JobHandler } from '../queue/job-runner';
import type { FollowUpService } from './followup.service';

/**
 * The check-up calendar's clock (spec M6).
 *
 * Hourly rather than by the minute: a milestone is a date, and a reminder that
 * arrives at 10:00 or 10:45 is the same reminder. The notification layer
 * decides the channel and whether quiet hours hold it.
 */
export function followUpSweep(followUp: FollowUpService): JobHandler {
  const logger = new Logger('FollowUpSweep');

  return async (): Promise<void> => {
    const { notified, missed } = await followUp.processDue();

    if (notified > 0 || missed > 0) {
      logger.log(`${notified} check-up(s) notified, ${missed} marked missed`);
    }
  };
}
