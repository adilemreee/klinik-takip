import { Logger } from '@nestjs/common';
import type { JobHandler } from '../queue/job-runner';
import type { EmergencyService } from './emergency.service';

/**
 * The escalation clock (spec M8).
 *
 * Every thirty seconds, because the first rung is two minutes: a sweep on a
 * one-minute cadence spends half of that window deciding whether to look.
 *
 * A sweep rather than a per-event timer. A timer lives in the memory of one
 * worker process, and the worker restarting is not a rare event — it happens on
 * every deploy. An emergency raised ninety seconds before a deploy must still
 * escalate.
 */
export function emergencyEscalation(emergency: EmergencyService): JobHandler {
  const logger = new Logger('EmergencyEscalation');

  return async (): Promise<void> => {
    const { escalated } = await emergency.escalateDue();

    if (escalated > 0) {
      logger.warn(`${escalated} emergency call(s) escalated — nobody had answered`);
    }
  };
}
