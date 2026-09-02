import { Logger } from '@nestjs/common';
import type { JobHandler } from '../queue/job-runner';
import type { MessagingService } from './messaging.service';

/**
 * Releases messages whose queue time has passed (spec M3).
 *
 * Runs often, because the promise made to the patient is a clock time: a
 * message told it would go at 18:00 and delivered at 18:55 has broken the one
 * assurance queueing was there to give.
 */
export function messageRelease(messaging: MessagingService): JobHandler {
  const logger = new Logger('MessageRelease');

  return async (): Promise<void> => {
    const released = await messaging.releaseQueued();

    if (released > 0) {
      logger.log(`Released ${released} message(s) held until the window opened`);
    }
  };
}
