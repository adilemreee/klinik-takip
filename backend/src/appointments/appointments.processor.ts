import { Logger } from '@nestjs/common';
import type { AppointmentsService } from './appointments.service';
import type { JobHandler } from '../queue/job-runner';

/**
 * Appointment reminders (spec M10).
 *
 * Every ten minutes. The offsets are days and hours, so the exact minute does
 * not matter — but the two-hour reminder does have to arrive while it is still
 * two hours, and an hourly sweep could make it ninety minutes.
 */
export function appointmentReminders(appointments: AppointmentsService): JobHandler {
  const logger = new Logger('AppointmentReminders');

  return async (): Promise<void> => {
    const sent = await appointments.sendDueReminders();

    if (sent > 0) {
      logger.log(`Reminded ${sent} appointment(s)`);
    }
  };
}
